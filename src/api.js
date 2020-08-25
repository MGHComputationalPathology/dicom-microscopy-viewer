import 'ol/ol.css';
import Collection from 'ol/Collection';
import Draw, { createRegularPolygon, createBox } from 'ol/interaction/Draw';
import EVENT from "./events";
import Feature from 'ol/Feature';
import FullScreen from 'ol/control/FullScreen';
import Map from 'ol/Map';
import Modify from 'ol/interaction/Modify';
import DragPan from 'ol/interaction/DragPan';
import MouseWheelZoom from 'ol/interaction/MouseWheelZoom';
import OverviewMap from 'ol/control/OverviewMap';
import Projection from 'ol/proj/Projection';
import publish from "./eventPublisher";
import ScaleLine from 'ol/control/ScaleLine';
import Select from 'ol/interaction/Select';
import TileLayer from 'ol/layer/Tile';
import TileImage from 'ol/source/TileImage';
import TileGrid from 'ol/tilegrid/TileGrid';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import View from 'ol/View';
import { default as PolygonGeometry } from 'ol/geom/Polygon';
import { default as PointGeometry } from 'ol/geom/Point';
import { default as LineStringGeometry } from 'ol/geom/LineString';
import { default as CircleGeometry } from 'ol/geom/Circle';
import { default as VectorEventType } from "ol/source/VectorEventType";
import { default as MapEventType } from "ol/MapEventType";
import { defaults as defaultInteractions } from 'ol/interaction';

import { getCenter } from 'ol/extent';
import { toStringXY, rotate } from 'ol/coordinate';

import { formatImageMetadata, getFrameMapping } from './metadata.js';
import { ROI } from './roi.js';
import {
    generateUID,
    mapPixelCoord2SlideCoord,
    mapSlideCoord2PixelCoord,
    generateOpenLayersCondition
} from './utils.js';
import {
  Point,
  Multipoint,
  Polyline,
  Polygon,
  Ellipsoid,
  Ellipse
} from './scoord3d.js';

import DICOMwebClient from 'dicomweb-client/build/dicomweb-client.js'


function _getPixelSpacing(metadata) {
  const functionalGroup = metadata.SharedFunctionalGroupsSequence[0];
  const pixelMeasures = functionalGroup.PixelMeasuresSequence[0];
  return pixelMeasures.PixelSpacing;
}


function _getRotation(metadata) {
  /*
   * Determine whether image needs to be rotated relative to slide
   * coordinate system based on direction cosines.
   * We want to rotate all images such that the X axis of the slide coordinate
   * system is the vertical axis (ordinate) of the viewport and the Y axis
   * of the slide coordinate system is the horizontal axis (abscissa) of the
   * viewport. Note that this is opposite to the Openlayers coordinate system.
   * There are only planar rotations, since the total pixel matrix is
   * parallel to the slide surface. Here, we further assume that rows and
   * columns of total pixel matrix are parallel to the borders of the slide,
   * i.e. the x and y axis of the slide coordinate system.
   *
   * The row direction (left to right) of the Total Pixel Matrix
   * is defined by the first three values.
   * The three values specify how the direction changes from the last pixel
   * to the first pixel in the row along each of the three axes of the
   * slide coordinate system (x, y, z), i.e. it express in which direction one
   * is moving in the slide coordinate system when the COLUMN index changes.
   * The column direction (top to bottom) of the Total Pixel Matrix
   * is defined by the second three values.
   * The three values specify how the direction changes from the last pixel
   * to the first pixel in the column along each of the three axes of the
   * slide coordinate system (x, y, z), i.e. it express in which direction one
   * is moving in the slide coordinate system when the ROW index changes.
  */

  var degrees;
  if (
    (metadata.ImageOrientationSlide[0] === 0) &&
    (metadata.ImageOrientationSlide[1] === -1) &&
    (metadata.ImageOrientationSlide[2] === 0) &&
    (metadata.ImageOrientationSlide[3] === -1) &&
    (metadata.ImageOrientationSlide[4] === 0) &&
    (metadata.ImageOrientationSlide[5] === 0)
  ) {
    /*
     * The Total Pixel Matrix is rotated with respect to the slide coordinate
     * system by 180 degrees, such that an increase along the row direction
     * (left to right) leads to lower Y coordinate values and an increase
     * along the column direction (top to bottom) leads to lower X coordinate
     * values.
     */
    degrees = 180;
  } else if (
    (metadata.ImageOrientationSlide[0] === 1) &&
    (metadata.ImageOrientationSlide[1] === 0) &&
    (metadata.ImageOrientationSlide[2] === 0) &&
    (metadata.ImageOrientationSlide[3] === 0) &&
    (metadata.ImageOrientationSlide[4] === -1) &&
    (metadata.ImageOrientationSlide[5] === 0)
  ) {
    /*
     * The Total Pixel Matrix is rotated with respect to the slide coordinate
     * system by 90 degrees, such that an increase along the row direction
     * (left to right) leads to higher X coordinate values and an increase
     * along the column direction (top to bottom) leads to lower Y coordinate
     * values.
     */
    degrees = 90;
  } else if (
    (metadata.ImageOrientationSlide[0] === -1) &&
    (metadata.ImageOrientationSlide[1] === 0) &&
    (metadata.ImageOrientationSlide[2] === 0) &&
    (metadata.ImageOrientationSlide[3] === 0) &&
    (metadata.ImageOrientationSlide[4] === 1) &&
    (metadata.ImageOrientationSlide[5] === 0)
  ) {
    /*
     * The Total Pixel Matrix is rotated with respect to the slide coordinate
     * system by 270 degrees, such that an increase along the row direction
     * (left to right) leads to lower X coordinate values and an increase
     * along the column direction (top to bottom) leads to higher Y coordinate
     * values.
     */
    degrees = 270;
  } else if (
    (metadata.ImageOrientationSlide[0] === 0) &&
    (metadata.ImageOrientationSlide[1] === 1) &&
    (metadata.ImageOrientationSlide[2] === 0) &&
    (metadata.ImageOrientationSlide[3] === 1) &&
    (metadata.ImageOrientationSlide[4] === 0) &&
    (metadata.ImageOrientationSlide[5] === 0)
  ) {
    /*
     * The Total Pixel Matrix is aligned with the slide coordinate system
     * such that an increase along the row direction (left to right) leads to
     * higher Y coordinate values and an increase along the column direction
     * (top to bottom) leads to higher X coordinate values.
     */
    degrees = 0;
  } else {
    throw new Error(`Unexpected image orientation ${metadata.ImageOrientationSlide}`);
  }
  return degrees * (Math.PI / 180);
}


function _geometry2Scoord3d(geometry, pyramid) {
  console.info('map coordinates from pixel matrix to slide coordinate system')
  const frameOfReferenceUID = pyramid[pyramid.length-1].FrameOfReferenceUID;
  const type = geometry.getType();
  if (type === 'Point') {
    let coordinates = geometry.getCoordinates();
    coordinates = _geometryCoordinates2scoord3dCoordinates(coordinates, pyramid);
    return new Point({
      coordinates,
      frameOfReferenceUID: frameOfReferenceUID
    });
  } else if (type === 'Polygon') {
    /*
     * The first linear ring of the array defines the outer-boundary (surface).
     * Each subsequent linear ring defines a hole in the surface.
     */
    let coordinates = geometry.getCoordinates()[0].map(c => {
      return _geometryCoordinates2scoord3dCoordinates(c, pyramid);
    });
    return new Polygon({
      coordinates,
      frameOfReferenceUID: frameOfReferenceUID
    });
  } else if (type === 'LineString') {
    let coordinates = geometry.getCoordinates().map(c => {
      return _geometryCoordinates2scoord3dCoordinates(c, pyramid);
    });
    return new Polyline({
      coordinates,
      frameOfReferenceUID: frameOfReferenceUID
    });
  } else if (type === 'Circle') {
    const center = geometry.getCenter();
    const radius = geometry.getRadius();
    // Endpoints of major and  minor axis of the ellipse.
    let coordinates = [
      [center[0] - radius, center[1], 0],
      [center[0] + radius, center[1], 0],
      [center[0], center[1] - radius, 0],
      [center[0], center[1] + radius, 0],
    ];
    coordinates = coordinates.map(c => {
        return _geometryCoordinates2scoord3dCoordinates(c, pyramid);
    })

    // const metadata = pyramid[pyramid.length-1];
    // const pixelSpacing = _getPixelSpacing(metadata);

    return new Ellipse({
      coordinates,
      frameOfReferenceUID: frameOfReferenceUID
    });
  } else {
    // TODO: Combine multiple points into MULTIPOINT.
    console.error(`unknown geometry type "${type}"`)
  }
}

function _scoord3d2Geometry(scoord3d, pyramid) {
  console.info('map coordinates from slide coordinate system to pixel matrix')
  const type = scoord3d.graphicType;
  const data = scoord3d.graphicData;

  if (type === 'POINT') {
    let coordinates = _scoord3dCoordinates2geometryCoordinates(data, pyramid);
    return new PointGeometry(coordinates);
  } else if (type === 'POLYLINE') {
    const coordinates = data.map(d => {
      return _scoord3dCoordinates2geometryCoordinates(d, pyramid);
    });
    return new LineStringGeometry(coordinates);
  } else if(type === 'POLYGON'){
    const coordinates = data.map(d => {
      return _scoord3dCoordinates2geometryCoordinates(d, pyramid);
    });
    return new PolygonGeometry([coordinates]);
  } else if (type === 'ELLIPSE') {
    // TODO: ensure that the ellipse represents a circle, i.e. that
    // major and minor axis form a right angle and have the same length
    const majorAxisCoordinates = data.slice(0, 2);
    const minorAxisCoordinates = data.slice(2, 4);
    // Circle is defined by two points: the center point and a point on the
    // circumference.
    const point1 = majorAxisCoordinates[0];
    const point2 = majorAxisCoordinates[1];
    let coordinates = [
      [
        (point1[0] + point2[0]) / parseFloat(2),
        (point1[1] + point2[1]) / parseFloat(2),
        0
      ],
      point2
    ];
    coordinates = coordinates.map(d => {
      return _scoord3dCoordinates2geometryCoordinates(d, pyramid);
    });
    // to flat coordinates
    coordinates = [...coordinates[0].slice(0,2), ...coordinates[1].slice(0,2)];

    // flat coordinates in combination with opt_layout and no opt_radius are also accepted
    // and internaly it calculates the Radius
    return new CircleGeometry(coordinates, null, "XY");
  } else {
    console.error(`unsupported graphic type "${type}"`)
  }
}

function _geometryCoordinates2scoord3dCoordinates(coordinates, pyramid) {
  return _coordinateFormatGeometry2Scoord3d([coordinates[0], coordinates[1], coordinates[2]], pyramid);
}

function _scoord3dCoordinates2geometryCoordinates(coordinates, pyramid) {
  return _coordinateFormatScoord3d2Geometry([coordinates[0], coordinates[1], coordinates[2]], pyramid)
}

/*
  * Translate pixel units of total pixel matrix into millimeters of
  * slide coordinate system
*/
function _coordinateFormatGeometry2Scoord3d(coordinates, pyramid) {
  let transform = false;
  if(!Array.isArray(coordinates[0])) {
    coordinates = [coordinates];
    transform = true;
  }
  const metadata = pyramid[pyramid.length-1];
  const origin = metadata.TotalPixelMatrixOriginSequence[0];
  const orientation = metadata.ImageOrientationSlide;
  const spacing = _getPixelSpacing(metadata);
  const offset = [
    Number(origin.XOffsetInSlideCoordinateSystem),
    Number(origin.YOffsetInSlideCoordinateSystem),
  ];

  coordinates = coordinates.map(c => {
    const pixelCoord = [c[0], -(c[1] + 1)];
    const slideCoord = mapPixelCoord2SlideCoord({
      orientation,
      spacing,
      offset,
      point: pixelCoord
    });
    return [slideCoord[0], slideCoord[1], 0];
  });
  if (transform) {
    return coordinates[0];
  }
  return coordinates;
}

/*
  * Translate millimeters into pixel units of total pixel matrix of
  * slide coordinate system
*/
function _coordinateFormatScoord3d2Geometry(coordinates, pyramid) {
  let transform = false;
  if(!Array.isArray(coordinates[0])) {
    coordinates = [coordinates];
    transform = true;
  }
  const metadata = pyramid[pyramid.length-1];
  const orientation = metadata.ImageOrientationSlide;
  const spacing = _getPixelSpacing(metadata);
  const origin = metadata.TotalPixelMatrixOriginSequence[0];
  const offset = [
    Number(origin.XOffsetInSlideCoordinateSystem),
    Number(origin.YOffsetInSlideCoordinateSystem),
  ];

  coordinates = coordinates.map(c =>{
    const slideCoord = [c[0], c[1]];
    const pixelCoord = mapSlideCoord2PixelCoord({
      offset,
      orientation,
      spacing,
      point: slideCoord
    });
    return [pixelCoord[0], -(pixelCoord[1] + 1), 0];
  });
  if (transform) {
    return coordinates[0];
  }
  return coordinates;
}

function _getROIFromFeature(feature, pyramid){
  let roi = {}
  if (feature !== undefined) {
    const geometry = feature.getGeometry();
    const scoord3d = _geometry2Scoord3d(geometry, pyramid);
    const properties = feature.getProperties();
    // Remove geometry from properties mapping
    const geometryName = feature.getGeometryName();
    delete properties[geometryName];
    const uid = feature.getId();
    roi = new ROI({scoord3d, properties, uid});
  }
  return roi;
}

const _client = Symbol('client');
const _controls = Symbol('controls');
const _drawingLayer = Symbol('drawingLayer');
const _drawingSource = Symbol('drawingSource');
const _features = Symbol('features');
const _imageLayer = Symbol('imageLayer');
const _interactions = Symbol('interactions');
const _map = Symbol('map');
const _metadata = Symbol('metadata');
const _pyramidMetadata = Symbol('pyramidMetadata');
const _pyramidFrameMappings = Symbol('pyramidFrameMappings');
const _pyramidBaseMetadata = Symbol('pyramidMetadataBase');
const _segmentations = Symbol('segmentations');
const _usewebgl = Symbol('usewebgl');


class VLWholeSlideMicroscopyImageViewer {

  /*
   * options:
   *   - client (instance of DICOMwebClient)
   *   - metadata (array of DICOM JSON metadata for each image instance)
   *   - retrieveRendered (whether frames should be retrieved using DICOMweb RetrieveRenderedTransaction; default: true)
   *   - useWebGL (whether WebGL renderer should be used; default: true)
   */
  constructor(options) {
    if ('useWebGL' in options) {
      this[_usewebgl] = options.useWebGL;
    } else {
      this[_usewebgl] = true;
    }
    this[_client] = options.client;

    if (!('retrieveRendered' in options)) {
      options.retrieveRendered = true;
    }

    if (!('controls' in options)) {
      options.controls = [];
    }
    options.controls = new Set(options.controls);

    // Collection of Openlayers "VectorLayer" instances indexable by
    // DICOM Series Instance UID
    this[_segmentations] = {};

    // Collection of Openlayers "Feature" instances
    this[_features] = new Collection([], {unique: true});
    // Add unique identifier to each created "Feature" instance
    this[_features].on('add', (e) => {
      // The ID may have already been set when drawn. However, features could
      // have also been added without a draw event.
      if (e.element.getId() === undefined) {
        e.element.setId(generateUID());
      }
    });

    /*
     * To visualize images accross multiple scales, we first need to
     * determine the image pyramid structure, i.e. the size and resolution
     * images at the different pyramid levels.
    */
    this[_metadata] = options.metadata.map(m => formatImageMetadata(m));
    // Sort instances and optionally concatenation parts if present.
    this[_metadata].sort((a, b) => {
      const sizeDiff = a.TotalPixelMatrixColumns - b.TotalPixelMatrixColumns;
      if (sizeDiff === 0) {
        if (a.ConcatenationFrameOffsetNumber !== undefined) {
          return a.ConcatenationFrameOffsetNumber - b.ConcatenationFrameOffsetNumber;
        }
        return sizeDiff;
      }
      return sizeDiff;
    });
    this[_pyramidMetadata] = [];
    this[_pyramidFrameMappings] = [];
    let frameMappings = this[_metadata].map(m => getFrameMapping(m));
    for (let i = 0; i < this[_metadata].length; i++) {
      const cols = this[_metadata][i].TotalPixelMatrixColumns;
      const rows = this[_metadata][i].TotalPixelMatrixRows;
      const numberOfFrames = this[_metadata][i].NumberOfFrames;
      /*
       * Instances may be broken down into multiple concatentation parts.
       * Therefore, we have to re-assemble instance metadata.
      */
      let alreadyExists = false;
      let index = null;
      for (let j = 0; j < this[_pyramidMetadata].length; j++) {
        if (
            (this[_pyramidMetadata][j].TotalPixelMatrixColumns === cols) &&
            (this[_pyramidMetadata][j].TotalPixelMatrixRows === rows)
          ) {
          alreadyExists = true;
          index = j;
        }
      }
      if (alreadyExists) {
        // Update with information obtained from current concatentation part.
        Object.assign(this[_pyramidFrameMappings][index], frameMappings[i]);
        this[_pyramidMetadata][index].NumberOfFrames += numberOfFrames;
        if ("PerFrameFunctionalGroupsSequence" in this[_metadata][index]) {
          this[_pyramidMetadata][index].PerFrameFunctionalGroupsSequence.push(
            ...this[_metadata][i].PerFrameFunctionalGroupsSequence
          );
        }
        if (!"SOPInstanceUIDOfConcatenationSource" in this[_metadata][i]) {
          throw new Error(
            'Attribute "SOPInstanceUIDOfConcatenationSource" is required ' +
            'for concatenation parts.'
          );
        }
        const sopInstanceUID = this[_metadata][i].SOPInstanceUIDOfConcatenationSource;
        this[_pyramidMetadata][index].SOPInstanceUID = sopInstanceUID;
        delete this[_pyramidMetadata][index].SOPInstanceUIDOfConcatenationSource;
        delete this[_pyramidMetadata][index].ConcatenationUID;
        delete this[_pyramidMetadata][index].InConcatenationNumber;
        delete this[_pyramidMetadata][index].ConcatenationFrameOffsetNumber;
      } else {
        this[_pyramidMetadata].push(this[_metadata][i]);
        this[_pyramidFrameMappings].push(frameMappings[i]);
      }
    }
    const nLevels = this[_pyramidMetadata].length;
    if (nLevels === 0) {
      console.error('empty pyramid - no levels found')
    }
    this[_pyramidBaseMetadata] = this[_pyramidMetadata][nLevels - 1];
    /*
     * Collect relevant information from DICOM metadata for each pyramid
     * level to construct the Openlayers map.
    */
    const tileSizes = [];
    const tileGridSizes = [];
    const resolutions = [];
    const origins = [];
    const offset = [0, -1];
    const basePixelSpacing = _getPixelSpacing(this[_pyramidBaseMetadata]);
    const baseTotalPixelMatrixColumns = this[_pyramidBaseMetadata].TotalPixelMatrixColumns;
    const baseTotalPixelMatrixRows = this[_pyramidBaseMetadata].TotalPixelMatrixRows;
    const baseColumns = this[_pyramidBaseMetadata].Columns;
    const baseRows = this[_pyramidBaseMetadata].Rows;
    const baseNColumns = Math.ceil(baseTotalPixelMatrixColumns / baseColumns);
    const baseNRows = Math.ceil(baseTotalPixelMatrixRows / baseRows);
    for (let j = (nLevels - 1); j >= 0; j--) {
      const columns = this[_pyramidMetadata][j].Columns;
      const rows = this[_pyramidMetadata][j].Rows;
      const totalPixelMatrixColumns = this[_pyramidMetadata][j].TotalPixelMatrixColumns;
      const totalPixelMatrixRows = this[_pyramidMetadata][j].TotalPixelMatrixRows;
      const pixelSpacing = _getPixelSpacing(this[_pyramidMetadata][j]);
      const nColumns = Math.ceil(totalPixelMatrixColumns / columns);
      const nRows = Math.ceil(totalPixelMatrixRows / rows);
      tileSizes.push([
        columns,
        rows,
      ]);
      tileGridSizes.push([
        nColumns,
        nRows,
      ]);

      /*
       * Compute the resolution at each pyramid level, since the zoom
       * factor may not be the same between adjacent pyramid levels.
      */
      let zoomFactor = pixelSpacing[0] / basePixelSpacing[0];
      resolutions.push(zoomFactor);

      /*
       * TODO: One may have to adjust the offset slightly due to the
       * difference between extent of the image at a given resolution level
       * and the actual number of tiles (frames).
      */
      origins.push(offset);
    }
    resolutions.reverse();
    tileSizes.reverse();
    tileGridSizes.reverse();
    origins.reverse();

    // Functions won't be able to access "this"
    const pyramid = this[_pyramidMetadata];
    const pyramidFrameMappings = this[_pyramidFrameMappings];

    /*
     * Define custom tile URL function to retrive frames via DICOMweb WADO-RS.
     */
    const tileUrlFunction = (tileCoord, pixelRatio, projection) => {
      /*
       * Variables x and y correspond to the X and Y axes of the slide
       * coordinate system. Since we want to view the slide horizontally
       * with the label on the right side, the x axis of the slide
       * coordinate system is the vertical axis of the viewport and the
       * y axis of the slide coordinate system the horizontal axis of the
       * viewport. Note that this is in contrast to the nomenclature used
       * by Openlayers.
       */
      let z = tileCoord[0];
      let y = tileCoord[1] + 1;
      let x = tileCoord[2] + 1;
      let index = x + "-" + y;
      let path = pyramidFrameMappings[z][index];
      if (path === undefined) {
        console.warn("tile " + index + " not found at level " + z);
        return(null);
      }
      let url = options.client.wadoURL +
        "/studies/" + pyramid[z].StudyInstanceUID +
        "/series/" + pyramid[z].SeriesInstanceUID +
        '/instances/' + path;
      if (options.retrieveRendered) {
        url = url + '/rendered';
      }
      return(url);
    }

    /*
     * Define custonm tile loader function, which is required because the
     * WADO-RS response message has content type "multipart/related".
    */
    const base64Encode = (data) => {
      const uint8Array = new Uint8Array(data);
      const chunkSize = 0x8000;
      const strArray = [];
      for (let i=0; i < uint8Array.length; i+=chunkSize) {
        const str = String.fromCharCode.apply(
          null, uint8Array.subarray(i, i + chunkSize)
        );
        strArray.push(str);
      }
      return btoa(strArray.join(''));
    }

    const tileLoadFunction = (tile, src) => {
      if (src !== null) {
        const studyInstanceUID = DICOMwebClient.utils.getStudyInstanceUIDFromUri(src);
        const seriesInstanceUID = DICOMwebClient.utils.getSeriesInstanceUIDFromUri(src);
        const sopInstanceUID = DICOMwebClient.utils.getSOPInstanceUIDFromUri(src);
        const frameNumbers = DICOMwebClient.utils.getFrameNumbersFromUri(src);
        const img = tile.getImage();
        if (options.retrieveRendered) {
          const mediaType = 'image/png';
          const retrieveOptions = {
            studyInstanceUID,
            seriesInstanceUID,
            sopInstanceUID,
            frameNumbers,
            mediaTypes: [{ mediaType }]
          };
          options.client.retrieveInstanceFramesRendered(retrieveOptions).then((renderedFrame) => {
            const blob = new Blob([renderedFrame], {type: mediaType});
            img.src = window.URL.createObjectURL(blob);
          });
        } else {
          // TODO: support "image/jp2" and "image/jls"
          const mediaType = 'image/jpeg';

          const retrieveOptions = {
            studyInstanceUID,
            seriesInstanceUID,
            sopInstanceUID,
            frameNumbers,
            mediaTypes: [{mediaType, transferSyntaxUID: '1.2.840.10008.1.2.4.50'}]
          };
          options.client.retrieveInstanceFrames(retrieveOptions).then((rawFrames) => {
            const blob = new Blob(rawFrames, {type: mediaType});
            img.src = window.URL.createObjectURL(blob);
          });
        }
      } else {
        console.warn('could not load tile');
      }
    }

    /*
     * Frames may extend beyond the size of the total pixel matrix.
     * The excess pixels are empty, i.e. have only a padding value.
     * We set the extent to the size of the actual image without taken
     * excess pixels into account.
     * Note that the vertical axis is flipped in the used tile source,
     * i.e. values on the axis lie in the range [-n, -1], where n is the
     * number of rows in the total pixel matrix.
    */
    const extent = [
      0,                                // min X
      -(baseTotalPixelMatrixRows + 1),  // min Y
      baseTotalPixelMatrixColumns,      // max X
      -1                                // max Y
    ];

    const rotation = _getRotation(this[_pyramidBaseMetadata]);

    /*
     * Specify projection to prevent default automatic projection
     * with the default Mercator projection.
     */
    const projection = new Projection({
      code: "NONE",
      units: 'metric',
      extent: extent,
      getPointResolution: function(pixelRes, point) {
        /*
         * DICOM pixel spacing has millimeter unit while the projection has
         * has meter unit.
         */
        let spacing = _getPixelSpacing(pyramid[nLevels-1])[0] / 10**3;
        let res = pixelRes * spacing;
        return(res);
      }
    });
    /*
     * TODO: Register custom projection:
     *  - http://openlayers.org/en/latest/apidoc/ol.proj.html
     *  - http://openlayers.org/en/latest/apidoc/module-ol_proj.html#~ProjectionLike
     * Direction cosines could be handled via projection rather
     * than specifying a rotation
     */

    /*
     * We need to specify the tile grid, since DICOM allows tiles to
     * have different sizes at each resolution level and a different zoom
     * factor between individual levels.
     */
    const tileGrid = new TileGrid({
      extent: extent,
      origins: origins,
      resolutions: resolutions,
      sizes: tileGridSizes,
      tileSizes: tileSizes
    });

    /*
     * We use the existing TileImage source but customize it to retrieve
     * frames (load tiles) via DICOMweb WADO-RS.
     */
    const rasterSource = new TileImage({
      crossOrigin: "Anonymous",
      tileGrid: tileGrid,
      projection: projection,
      wrapX: false
    });
    rasterSource.setTileUrlFunction(tileUrlFunction);
    rasterSource.setTileLoadFunction(tileLoadFunction);

    this[_imageLayer] = new TileLayer({
      extent: extent,
      source: rasterSource,
      preload: 0,
      projection: projection
    });

    this[_drawingSource] = new VectorSource({
      tileGrid: tileGrid,
      projection: projection,
      features: this[_features],
      wrapX: false
    });

    this[_drawingLayer] = new VectorLayer({
      extent: extent,
      source: this[_drawingSource],
      projection: projection,
      updateWhileAnimating: true,
      updateWhileInteracting: true,
    });

    const view = new View({
      center: getCenter(extent),
      extent: extent,
      projection: projection,
      resolutions: resolutions,
      rotation: rotation
    });

    this[_interactions] = {
      draw: undefined,
      select: undefined,
      modify: undefined,
      dragPan: undefined
    };

    this[_controls] = {
      scale: new ScaleLine({
        units: 'metric',
        className: ''
      })
    }
    if (options.controls.has('fullscreen')) {
      this[_controls].fullscreen = new FullScreen();
    }
    if (options.controls.has('overview')) {
      const overviewImageLayer = new TileLayer({
        extent: extent,
        source: rasterSource,
        preload: 0,
        projection: projection
      });

      const overviewView = new View({
        projection: projection,
        resolutions: resolutions,
        rotation: rotation
      });

      this[_controls].overview = new OverviewMap({
        view: overviewView,
        layers: [overviewImageLayer],
        collapsed: true,
      });
    }

    /*
     * Creates the map with the defined layers and view and renders it via
     * WebGL.
     */
    this[_map] = new Map({
      layers: [this[_imageLayer], this[_drawingLayer]],
      view: view,
      controls: [],
      keyboardEventTarget: document,
    });
    this[_map].addInteraction(new MouseWheelZoom());

    for (let control in this[_controls]) {
      this[_map].addControl(this[_controls][control]);
    }
    this[_map].getView().fit(extent);
  }

  resize(){
    this[_map].updateSize();
  }

  /* Gets the DICOM metadata for each image instance.
   */
  getMetadata(){
    return this[_pyramidMetadata];
  }

  /* Renders the images.
   */
  render(options) {
    if (!('container' in options)) {
      console.error('container must be provided for rendering images')
    }
    this[_map].setTarget(options.container);

    // Style scale element (overriding default Openlayers CSS "ol-scale-line")
    let scaleElement = this[_controls]['scale'].element;
    scaleElement.style.position = 'absolute';
    scaleElement.style.right = '.5em';
    scaleElement.style.bottom = '.5em';
    scaleElement.style.left = 'auto';
    scaleElement.style.padding = '2px';
    scaleElement.style.backgroundColor = 'rgba(255,255,255,.5)';
    scaleElement.style.borderRadius = '4px';
    scaleElement.style.margin = '1px';

    let scaleInnerElement = this[_controls]['scale'].innerElement_;
    scaleInnerElement.style.color = 'black';
    scaleInnerElement.style.fontWeight = '600';
    scaleInnerElement.style.fontSize = '10px';
    scaleInnerElement.style.textAlign = 'center';
    scaleInnerElement.style.borderWidth = '1.5px';
    scaleInnerElement.style.borderStyle = 'solid';
    scaleInnerElement.style.borderTop = 'none';
    scaleInnerElement.style.borderRightColor = 'black';
    scaleInnerElement.style.borderLeftColor = 'black';
    scaleInnerElement.style.borderBottomColor = 'black';
    scaleInnerElement.style.margin = '1px';
    scaleInnerElement.style.willChange = 'contents,width';

    const container = this[_map].getTargetElement();

    this[_drawingSource].on(VectorEventType.ADDFEATURE, (e) => {
      publish(container, EVENT.ROI_ADDED, _getROIFromFeature(e.feature, this[_pyramidMetadata]));
    });

    this[_drawingSource].on(VectorEventType.CHANGEFEATURE, (e) => {
      if (e.feature !== undefined || e.feature !== null) {
        const geometry = e.feature.getGeometry();
        const type = geometry.getType();
        // The first and last point of a polygon must be identical. The last point
        // is an implmentation detail and is hidden from the user in the graphical
        // interface. However, we must update the last point in case the first
        // piont has been modified by the user.
        if (type === 'Polygon') {
          // NOTE: Polyon in GeoJSON format contains an array of geometries,
          // where the first element represents the coordinates of the outer ring
          // and the second element represents the coordinates of the inner ring
          // (in our case the inner ring should not be present).
          const layout = geometry.getLayout();
          const coordinates = geometry.getCoordinates();
          const firstPoint = coordinates[0][0];
          const lastPoint = coordinates[0][coordinates[0].length-1];
          if (firstPoint[0] !== lastPoint[0] || firstPoint[1] !== lastPoint[1]) {
            coordinates[0][coordinates[0].length-1] = firstPoint;
            geometry.setCoordinates(coordinates, layout);
            e.feature.setGeometry(geometry);
          }
        }
      }
      publish(container, EVENT.ROI_MODIFIED, _getROIFromFeature(e.feature, this[_pyramidMetadata]));
    });

    this[_drawingSource].on(VectorEventType.REMOVEFEATURE, (e) => {
      publish(container, EVENT.ROI_REMOVED, _getROIFromFeature(e.feature, this[_pyramidMetadata]));
    });

    this[_map].on(MapEventType.MOVESTART, (e) => {
      publish(container, EVENT.MOVE_STARTED, this.getAllROIs());
    });

    this[_map].on(MapEventType.MOVEEND, (e) => {
      publish(container, EVENT.MOVE_ENDED, this.getAllROIs());
    });

  }

  /* Activate draw interaction.
   */
  activateDrawInteraction(options) {
    this.deactivateDrawInteraction();
    console.info('activate "draw" interaction')

    const customOptionsMapping = {
      point: {
        type: 'Point',
        geometryName: 'Point'
      },
      circle: {
        type: 'Circle',
        geometryName: 'Circle'
      },
      box: {
        type: 'Circle',
        geometryName: 'Box',
        geometryFunction: createRegularPolygon(4),
      },
      polygon: {
        type: 'Polygon',
        geometryName: 'Polygon',
        freehand: false,
      },
      freehandpolygon: {
        type: 'Polygon',
        geometryName: 'FreeHandPolygon',
        freehand: true,
      },
      line: {
        type: 'LineString',
        geometryName: 'Line',
        freehand: false,
      },
      freehandline: {
        type: 'LineString',
        geometryName: 'FreeHandLine',
        freehand: true,
      },
    };
    if (!('geometryType' in options)) {
      console.error('geometry type must be specified for drawing interaction')
    }
    if (!(options.geometryType in customOptionsMapping)) {
      console.error(`unsupported geometry type "${options.geometryType}"`)
    }

    const defaultDrawOptions = {source: this[_drawingSource]};
    const customDrawOptions = customOptionsMapping[options.geometryType];
    if ('style' in options) {
      customDrawOptions.style = options.style;
    }
    const allDrawOptions = Object.assign(defaultDrawOptions, customDrawOptions);

    if (options.bindings) {
      allDrawOptions.condition = generateOpenLayersCondition(options.bindings);
    }

    this[_interactions].draw = new Draw(allDrawOptions);

    const container = this[_map].getTargetElement();

    //attaching openlayers events handling
    this[_interactions].draw.on('drawend', (e) => {
      e.feature.setId(generateUID());
      publish(container, EVENT.ROI_DRAWN, _getROIFromFeature(e.feature, this[_pyramidMetadata]));
    });

    this[_map].addInteraction(this[_interactions].draw);

  }

  /* Deactivate draw interaction.
   */
  deactivateDrawInteraction() {
    console.info('deactivate "draw" interaction')
    if (this[_interactions].draw !== undefined) {
      this[_map].removeInteraction(this[_interactions].draw);
      this[_interactions].draw = undefined;
    }
  }

  get isDrawInteractionActive() {
    return this[_interactions].draw !== undefined;
  }

  /* Activate select interaction.
   */
  activateSelectInteraction(options={}) {
    this.deactivateSelectInteraction();
    console.info('activate "select" interaction')

    const selectOptions = {layers: [this[_drawingLayer]]}

    if (options.bindings) {
      selectOptions.condition = generateOpenLayersCondition(options.bindings);
    }

    this[_interactions].select = new Select(selectOptions);

    const container = this[_map].getTargetElement();

    this[_interactions].select.on('select', (e) => {
      publish(container, EVENT.ROI_SELECTED, _getROIFromFeature(e.selected[0], this[_pyramidMetadata]));
    });

    this[_map].addInteraction(this[_interactions].select);
  }

  /* Deactivate select interaction.
   */
  deactivateSelectInteraction() {
    console.info('deactivate "select" interaction')
    if (this[_interactions].select) {
      this[_map].removeInteraction(this[_interactions].select);
      this[_interactions].select = undefined;
    }
  }

  get isSelectInteractionActive() {
    return this[_interactions].select !== undefined;
  }

  /* Activate modify interaction.
   */
  activateModifyInteraction(options={}) {
    this.deactivateModifyInteraction();
    console.info('activate "modify" interaction')


    const modifyOptions = {
      features: this[_features],  // TODO: or source, i.e. "drawings"???
    }

    if (options.bindings) {
      modifyOptions.condition = generateOpenLayersCondition(options.bindings);
    }
    
    this[_interactions].modify = new Modify(
      modifyOptions
    );
    this[_map].addInteraction(this[_interactions].modify);
  }



  

  /* Deactivate modify interaction.
   */
  deactivateModifyInteraction() {
    console.info('deactivate "modify" interaction')
    if (this[_interactions].modify) {
      this[_map].removeInteraction(this[_interactions].modify);
      this[_interactions].modify = undefined;
    }
  }


  activateDragPanInteraction(options={}) {
    this.deactivateDragPanInteraction();
    console.info('activate "drag pan" interaction')


    const modifyOptions = {
      features: this[_features],  // TODO: or source, i.e. "drawings"???
    }

    if (options.bindings) {
      modifyOptions.condition = generateOpenLayersCondition(options.bindings);
    }

    this[_interactions].dragPan = new DragPan(
      modifyOptions
    );
    this[_map].addInteraction(this[_interactions].dragPan);
  }


  /* Deactivate drag pan interaction.
   */
  deactivateDragPanInteraction() {
    console.info('deactivate "drag pan" interaction')
    if (this[_interactions].modify) {
      this[_map].removeInteraction(this[_interactions].dragPan);
      this[_interactions].dragPan = undefined;
    }
  }

  get isModifyInteractionActive() {
    return this[_interactions].modify !== undefined;
  }

  getAllROIs() {
    console.info('get all ROIs')
    let rois = [];
    this[_features].forEach((item) => {
        rois.push(this.getROI(item.getId()));
    });
    return rois;
  }

  get numberOfROIs() {
    return this[_features].getLength();
  }

  getROI(uid) {
    console.info(`get ROI ${uid}`)
    const feature = this[_drawingSource].getFeatureById(uid);
    return _getROIFromFeature(feature, this[_pyramidMetadata]);
  }

  popROI() {
    console.info('pop ROI')
    const feature = this[_features].pop();
    return _getROIFromFeature(feature, this[_pyramidMetadata]);
  }

  addROI(item) {
    console.info(`add ROI ${item.uid}`)
    const geometry = _scoord3d2Geometry(item.scoord3d, this[_pyramidMetadata]);
    const feature = new Feature(geometry);
    feature.setProperties(item.properties, true);
    feature.setId(item.uid);
    this[_features].push(feature);
  }

  removeROI(uid) {
    console.info(`remove ROI ${uid}`)
    const feature = this[_drawingSource].getFeatureById(uid);
    this[_features].remove(feature);
  }

  removeAllROIs() {
    console.info('remove all ROIs')
    this[_features].clear();
  }

  hideROIs() {
    console.info('hide ROIs')
    this[_drawingLayer].setVisible(false);
  }

  showROIs() {
    console.info('show ROIs')
    this[_drawingLayer].setVisible(true);
  }

  get areROIsVisible() {
    return this[_drawingLayer].getVisible();
  }

  get imageMetadata() {
    return this[_pyramidMetadata];
  }

}

export { VLWholeSlideMicroscopyImageViewer };
