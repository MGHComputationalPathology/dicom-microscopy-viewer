import WebGLMap from 'ol/WebGLMap';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import TileGrid from 'ol/tilegrid/TileGrid';
import Projection from 'ol/proj/Projection';
import OverviewMap from 'ol/control/OverviewMap';
import FullScreen from 'ol/control/FullScreen';
import ScaleLine from 'ol/control/ScaleLine';
import Draw, {createRegularPolygon, createBox} from 'ol/interaction/Draw';
import Select from 'ol/interaction/Select';
import Modify from 'ol/interaction/Modify';
import MultiPoint from 'ol/geom/MultiPoint.js';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Collection from 'ol/Collection';
import Feature from 'ol/Feature';
import { default as PolygonGeometry } from 'ol/geom/Polygon';
import { default as PointGeometry } from 'ol/geom/Point';
import { default as LineStringGeometry } from 'ol/geom/LineString';
import { default as CircleGeometry } from 'ol/geom/Circle';
import publish from "./eventPublisher";
import EVENT from "./events";
import { default as VectorEventType } from "ol/source/VectorEventType";
import { default as MapEventType } from "ol/MapEventType";

import { getCenter } from 'ol/extent';
import { toStringXY } from 'ol/coordinate';

import { formatImageMetadata } from './metadata.js';
import { ROI } from './roi.js';
import {
  Point,
  Multipoint,
  Polyline,
  Polygon,
  Circle,
  Ellipse
} from './scoord3d.js';

import DICOMwebClient from 'dicomweb-client/build/dicomweb-client.js'

function _geometry2Scoord3d(geometry, pyramid) {
  const type = geometry.getType();
  if (type === 'Point') {
    let coordinates = geometry.getCoordinates();
    coordinates = _geometryCoordinates2scoord3dCoordinates(coordinates, pyramid);
    return new Point(coordinates);
  } else if (type === 'Polygon') {
    /*
     * The first linear ring of the array defines the outer-boundary (surface).
     * Each subsequent linear ring defines a hole in the surface.
     */
    let coordinates = geometry.getCoordinates()[0].map(c => {
      return _geometryCoordinates2scoord3dCoordinates(c, pyramid);
    });
    return new Polygon(coordinates);
  } else if (type === 'LineString') {
    let coordinates = geometry.getCoordinates().map(c => {
      return _geometryCoordinates2scoord3dCoordinates(c, pyramid);
    });
    return new Polyline(coordinates);
  } else if (type === 'Circle') {
    // chunking the Flat Coordinates into two arrays within 3 elements each
    let coordinates = geometry.getFlatCoordinates().reduce((all,one,i) => {
      const ch = Math.floor(i/2)
      all[ch] = [].concat((all[ch]||[]),one)
      return all
    }, [])
    coordinates = coordinates.map(c => {
      c.push(0)
      return _geometryCoordinates2scoord3dCoordinates(c, pyramid)
    })
    return new Circle(coordinates);    
  } else {
    // TODO: Combine multiple points into MULTIPOINT.
    console.error(`unknown geometry type "${type}"`)
  }
}

function _scoord3d2Geometry(scoord3d, pyramid) {
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
  } else if (type === 'CIRCLE') {
    let coordinates = data.map(d => {
      return _scoord3dCoordinates2geometryCoordinates(d, pyramid);
    })
    // to flat coordinates
    coordinates = [...coordinates[0].slice(0,2), ...coordinates[1].slice(0,2)]

    // flat coordinates in combination with opt_layout and no opt_radius are also accepted
    // and internaly it calculates the Radius
    return new CircleGeometry(coordinates, null, "XY");
  } else {
    console.error(`unsupported graphic type "${type}"`)
  }
}

function _geometryCoordinates2scoord3dCoordinates(coordinates, pyramid) {
  return _coordinateFormatGeometry2Scoord3d([coordinates[0] + 1, -coordinates[1], coordinates[2]], pyramid);
}

function _scoord3dCoordinates2geometryCoordinates(coordinates, pyramid) {
  return _coordinateFormatScoord3d2Geometry([coordinates[0], coordinates[1], coordinates[2]], pyramid)
}

/*
  * Translate pixel units of total pixel matrix into millimeters of
  * slide coordinate system
*/
function _coordinateFormatGeometry2Scoord3d(coordinates, pyramid) {
  if(coordinates.length === 3){
    coordinates = [coordinates];
  }
  coordinates.map(coord =>{
    let x = (coord[0] * pyramid[pyramid.length-1].pixelSpacing[0]).toFixed(4);
    let y = (-(coord[1] - 1) * pyramid[pyramid.length-1].pixelSpacing[1]).toFixed(4);
    let z = (1).toFixed(4);
    coordinates = [Number(x), Number(y), Number(z)];
  })
  return(coordinates);
}

/*
  * Translate millimeters into pixel units of total pixel matrix of
  * slide coordinate system
*/
function _coordinateFormatScoord3d2Geometry(coordinates, pyramid) {
  if(coordinates.length === 3){
    coordinates = [coordinates];
  }
  coordinates.map(coord =>{
    let x = (coord[0] / pyramid[pyramid.length-1].pixelSpacing[0] - 1);
    let y = (coord[1] / pyramid[pyramid.length-1].pixelSpacing[1] - 1);
    let z = coord[2];
    coordinates = [x, y, z];
  });
   return(coordinates);
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
    roi = new ROI({scoord3d, properties});
  }
  return roi;
}

const _usewebgl = Symbol('usewebgl');
const _map = Symbol('map');
const _features = Symbol('features');
const _drawingSource = Symbol('drawingSource');
const _drawingLayer = Symbol('drawingLayer');
const _segmentations = Symbol('segmentations');
const _pyramid = Symbol('pyramid');
const _client = Symbol('client');
const _controls = Symbol('controls');
const _interactions = Symbol('interactions');

class VLWholeSlideMicroscopyImageViewer {

  /*
   * options:
   *   - client (instance of DICOMwebClient)
   *   - metadata (array of DICOM JSON metadata for each image instance)
   *   - retrieveRendered (whether frames should be retrieved using DICOMweb RetrieveRenderedTransaction)
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
      options.retrieveRendered = false;
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

    /*
     * To visualize images accross multiple scales, we first need to
     * determine the image pyramid structure, i.e. the size and resolution
     * images at the different pyramid levels.
    */
    const metadata = options.metadata.map(m => formatImageMetadata(m));
    this._pyramid = [];
    for (let i = 0; i < metadata.length; i++) {
      const cols = metadata[i].totalPixelMatrixColumns;
      const rows = metadata[i].totalPixelMatrixRows;
      const mapping = metadata[i].frameMapping;
      /*
       * Instances may be broken down into multiple concatentation parts.
       * Therefore, we have to re-assemble instance metadata.
      */
      let alreadyExists = false;
      let index = null;
      for (let j = 0; j < this._pyramid.length; j++) {
        if (
            (this._pyramid[j].totalPixelMatrixColumns === cols) &&
            (this._pyramid[j].totalPixelMatrixRows === rows)
          ) {
          alreadyExists = true;
          index = j;
        }
      }
      if (alreadyExists) {
        // Update with information obtained from current concatentation part.
        Object.assign(this._pyramid[index].frameMapping, mapping);
      } else {
        this._pyramid.push(metadata[i]);
      }
    }
    // Sort levels in ascending order
    this._pyramid.sort(function(a, b) {
      if(a.totalPixelMatrixColumns < b.totalPixelMatrixColumns) {
        return -1;
      } else if(a.totalPixelMatrixColumns > b.totalPixelMatrixColumns) {
        return 1;
      } else {
        return 0;
      }
    });

    /*
     * Collect relevant information from DICOM metadata for each pyramid
     * level to construct the Openlayers map.
    */
    const tileSizes = [];
    const totalSizes = [];
    const resolutions = [];
    const origins = [];
    const offset = [0, -1];
    const nLevels = this._pyramid.length;
    if (nLevels === 0) {
      console.error('empty pyramid - no levels found')
    }
    const basePixelSpacing = this._pyramid[nLevels-1].pixelSpacing;
    const baseColumns = this._pyramid[nLevels-1].columns;
    const baseRows = this._pyramid[nLevels-1].rows;
    const baseTotalPixelMatrixColumns = this._pyramid[nLevels-1].totalPixelMatrixColumns;
    const baseTotalPixelMatrixRows = this._pyramid[nLevels-1].totalPixelMatrixRows;
    const baseColFactor = Math.ceil(baseTotalPixelMatrixColumns / baseColumns);
    const baseRowFactor = Math.ceil(baseTotalPixelMatrixRows / baseRows);
    const baseAdjustedTotalPixelMatrixColumns = baseColumns * baseColFactor;
    const baseAdjustedTotalPixelMatrixRows = baseRows * baseRowFactor;
    for (let j = (nLevels - 1); j >= 0; j--) {
      let columns = this._pyramid[j].columns;
      let rows = this._pyramid[j].rows;
      let totalPixelMatrixColumns = this._pyramid[j].totalPixelMatrixColumns;
      let totalPixelMatrixRows = this._pyramid[j].totalPixelMatrixRows;
      let pixelSpacing = this._pyramid[j].pixelSpacing;
      let colFactor = Math.ceil(totalPixelMatrixColumns / columns);
      let rowFactor = Math.ceil(totalPixelMatrixRows / rows);
      let adjustedTotalPixelMatrixColumns = columns * colFactor;
      let adjustedTotalPixelMatrixRows = rows * rowFactor;
      tileSizes.push([columns, rows]);
      totalSizes.push([adjustedTotalPixelMatrixColumns, adjustedTotalPixelMatrixRows]);

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
    origins.reverse();

    const pyramid = this._pyramid;

    /*
     * Define custom tile URL function to retrive frames via DICOMweb
     * WADO-RS.
     */
    function tileUrlFunction(tileCoord, pixelRatio, projection) {
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
      /*
       * The vertical axis is inverted for the chosen tile source, i.e.
       * it starts at -1 at the top left corner and descreases along the
       * vertical axis to the lower left corner of the viewport.
       */
      let x = -(tileCoord[2] + 1) + 1;
      let index = x + "-" + y;
      let path = pyramid[z].frameMapping[index];
      if (path === undefined) {
        console.warn("tile " + index + " not found at level " + z);
        return(null);
      }
      let url = options.client.wadoURL +
        "/studies/" + pyramid[z].studyInstanceUID +
        "/series/" + pyramid[z].seriesInstanceUID +
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
    function base64Encode(data){
      const uint8Array = new Uint8Array(data);
      const chunkSize = 0x8000;
      const strArray = [];
      for (let i=0; i < uint8Array.length; i+=chunkSize) {
        let str = String.fromCharCode.apply(
          null, uint8Array.subarray(i, i + chunkSize)
        );
        strArray.push(str);
      }
      return btoa(strArray.join(''));
    }

    function tileLoadFunction(tile, src) {
      if (src !== null) {
        const studyInstanceUID = DICOMwebClient.utils.getStudyInstanceUIDFromUri(src);
        const seriesInstanceUID = DICOMwebClient.utils.getSeriesInstanceUIDFromUri(src);
        const sopInstanceUID = DICOMwebClient.utils.getSOPInstanceUIDFromUri(src);
        const frameNumbers = DICOMwebClient.utils.getFrameNumbersFromUri(src);
        const img = tile.getImage();
        if (options.retrieveRendered) {
          const mimeType = 'image/png';
          const retrieveOptions = {
            studyInstanceUID,
            seriesInstanceUID,
            sopInstanceUID,
            frameNumbers,
            mimeType
          };
          options.client.retrieveInstanceFramesRendered(retrieveOptions).then((renderedFrame) => {
            const blob = new Blob([renderedFrame], {type: mimeType});
            img.src = window.URL.createObjectURL(blob);
          });
        } else {
          // TODO: support "image/jp2" and "image/jls"
          const mimeType = 'image/jpeg';
          const retrieveOptions = {
            studyInstanceUID,
            seriesInstanceUID,
            sopInstanceUID,
            frameNumbers,
            mimeType
          };
          options.client.retrieveInstanceFrames(retrieveOptions).then((rawFrames) => {
            const blob = new Blob(rawFrames, {type: mimeType});
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
      0,                            // min X
      -baseTotalPixelMatrixRows,    // min Y
      baseTotalPixelMatrixColumns,  // max X
      -1                            // max Y
    ];

    /*
     * Determine whether image needs to be rotated relative to slide
     * coordinate system based on direction cosines.
     * There are only planar rotations, since the total pixel matrix is
     * parallel to the slide surface. Here, we further assume that rows and
     * columns of total pixel matrix are parallel to the borders of the slide,
     * i.e. the x and y axis of the slide coordinate system.
     * Hence, we only account for the case where the image may be rotated by
     * 180 degrees.
    */
    var degrees = 0;
    if (
      (this._pyramid[this._pyramid.length-1].imageOrientationSlide[1] === -1) &&
      (this._pyramid[this._pyramid.length-1].imageOrientationSlide[3] === -1)
    ) {
      /*
       * The row direction (left to right) of the total pixel matrix
       * is defined by the first three values.
       * The three values specify how the direction changes from the last pixel
       * to the first pixel in the row along each of the three axes of the
       * slide coordinate system (x, y, z), i.e. it express in which direction one
       * is moving in the slide coordinate system when the COLUMN index changes.
       * The column direction (top to bottom) of the total pixel matrix
       * is defined by the first three values.
       * The three values specify how the direction changes from the last pixel
       * to the first pixel in the column along each of the three axes of the
       * slide coordinate system (x, y, z), i.e. it express in which direction one
       * is moving in the slide coordinate system when the ROW index changes.
      */
      degrees = 180;
    }
    const rotation = degrees * (Math.PI / 180);

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
        let spacing = pyramid[nLevels-1].pixelSpacing[0] / 10**3;
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
      sizes: totalSizes,
      tileSizes: tileSizes
    });

    /*
     * We use the implemented XYZ tile source but customize it to retrieve
     * frames (load tiles) via DICOMweb WADO-RS.
     */
    const rasterSource = new XYZ({
      crossOrigin: "Anonymous",
      tileGrid: tileGrid,
      projection: projection,
      wrapX: false
    });
    rasterSource.setTileUrlFunction(tileUrlFunction);
    rasterSource.setTileLoadFunction(tileLoadFunction);

    const imageLayer = new TileLayer({
      extent: extent,
      source: rasterSource,
      preload: 1,
      projection: projection
    });

    let styles;

    if('style' in options){
      styles = [options.style.getStyle()]
    }

    this[_drawingSource] = new VectorSource({
      tileGrid: tileGrid,
      projection: projection,
      features: this[_features],
      wrapX: false
    });

    this[_drawingLayer] = new VectorLayer({
      extent: extent,
      source: this[_drawingSource],
      style: styles,
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

    const overviewView = new View({
      projection: projection,
      resolutions: resolutions,
      rotation: rotation
    });

    this[_interactions] = {
      draw: undefined,
      select: undefined,
      modify: undefined
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
      this[_controls].overview = new OverviewMap({
        view: overviewView,
        collapsed: true,
      });
    }

    /*
     * Creates the map with the defined layers and view and renders it via
     * WebGL.
     */
    if (this[_usewebgl]) {
      this[_map] = new WebGLMap({
        layers: [imageLayer, this[_drawingLayer]],
        view: view,
        controls: [],
        loadTilesWhileAnimating: true,
        loadTilesWhileInteracting: true,
        logo: false
      });
    } else {

      this[_map] = new Map({
        layers: [imageLayer, this[_drawingLayer]],
        view: view,
        controls: [],
        loadTilesWhileAnimating: true,
        loadTilesWhileInteracting: true,
        logo: false
      });
    }

    for (let control in this[_controls]) {
      this[_map].addControl(this[_controls][control]);
    }
    this[_map].getView().fit(extent, this[_map].getSize());

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
    const pyramid = this._pyramid;

    this[_drawingSource].on(VectorEventType.ADDFEATURE, (e) => {
      publish(container, EVENT.ROI_ADDED, _getROIFromFeature(e.feature, pyramid));
    });

    this[_drawingSource].on(VectorEventType.CHANGEFEATURE, (e) => {
      publish(container, EVENT.ROI_MODIFIED, _getROIFromFeature(e.feature, pyramid));
    });

    this[_drawingSource].on(VectorEventType.REMOVEFEATURE, (e) => {
      publish(container, EVENT.ROI_REMOVED, _getROIFromFeature(e.feature, pyramid));
    });

    this[_map].on(MapEventType.MOVESTART, (e) => {
      publish(container, EVENT.DICOM_MOVE_STARTED, this.getAllROIs());
    });

    this[_map].on(MapEventType.MOVEEND, (e) => {
      publish(container, EVENT.DICOM_MOVE_ENDED, this.getAllROIs());
    });

  }

  /* Activate draw interaction.
   */
  activateDrawInteraction(options) {
    this.deactivateDrawInteraction();

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
    const allDrawOptions = Object.assign(defaultDrawOptions, customDrawOptions);
    this[_interactions].draw = new Draw(allDrawOptions);
    
    if ('style' in options) {
      this[_interactions].draw.on('drawstart',function(event){
        event.feature.setStyle(options.style.getStyle());    
      });
    }

    const container = this[_map].getTargetElement();

    //attaching openlayers events handling
    this[_interactions].draw.on('drawend', (e) => {
      publish(container, EVENT.ROI_DRAWN, _getROIFromFeature(e.feature, this._pyramid));
    });

    this[_map].addInteraction(this[_interactions].draw);

  }

  /* Deactivate draw interaction.
   */
  deactivateDrawInteraction() {
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
    this[_interactions].select = new Select({
      layers: [this[_drawingLayer]]
    });

    const container = this[_map].getTargetElement();

    this[_interactions].select.on('select', (e) => {
      publish(container, EVENT.ROI_SELECTED, _getROIFromFeature(e.selected[0], this._pyramid));
    });

    this[_map].addInteraction(this[_interactions].select);
  }

  /* Deactivate select interaction.
   */
  deactivateSelectInteraction() {
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
    this[_interactions].modify = new Modify({
      features: this[_features],  // TODO: or source, i.e. "drawings"???
    });
    this[_map].addInteraction(this[_interactions].modify);
  }

  /* Deactivate modify interaction.
   */
  deactivateModifyInteraction() {
    if (this[_interactions].modify) {
      this[_map].removeInteraction(this[_interactions].modify);
      this[_interactions].modify = undefined;
    }
  }

  get isModifyInteractionActive() {
    return this[_interactions].modify !== undefined;
  }

  getAllROIs() {
    let rois = [];
    if (this.numberOfROIs > 0) {
      for(let index = 0; index < this.numberOfROIs; index++){
        rois.push(this.getROI(index));
      }
    }
    return rois;
  }

  get numberOfROIs() {
    return this[_features].getLength();
  }

  getROI(index) {
    const feature = this[_features].item(index);
    return _getROIFromFeature(feature, this._pyramid);
  }

  popROI() {
    const feature = this[_features].pop();
    return _getROIFromFeature(feature, this._pyramid);
  }

  addROI(item) {
    const geometry = _scoord3d2Geometry(item.scoord3d, this._pyramid);
    const feature = new Feature(geometry);
    feature.setProperties(item.properties, true);
    this[_features].push(feature);
  }

  updateROI(index, item) {
    const geometry = _scoord3d2Geometry(item.scoord3d, this._pyramid);
    const feature = new Feature(geometry);
    feature.setProperties(item.properties, true);
    this[_features].setAt(index, feature);
  }

  removeROI(index) {
    this[_features].removeAt(index);
  }

  hideROIs() {
    this[_drawingLayer].setVisible(false);
  }

  showROIs() {
    this[_drawingLayer].setVisible(true);
  }

  get areROIsVisible() {
    return this[_drawingLayer].getVisible();
  }

}

export { VLWholeSlideMicroscopyImageViewer };
