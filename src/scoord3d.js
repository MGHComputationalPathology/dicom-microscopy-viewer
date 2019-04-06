/*
 * Spatial coordinates of a geometric region of interest (ROI) in the DICOM
 * image coordinate system.
 */
const _coordinates = Symbol('coordinates')
const _majorAxisEndpointCoordinates = Symbol('majorAxisEndpointCoordinates')
const _minorAxisEndpointCoordinates = Symbol('minorAxisEndpointCoordinates')

class Scoord3D {

  constructor() {}

  get graphicData() {
    throw new Error('Prototype property "graphicData" must be implemented.')
  }

  get graphicType() {
    throw new Error('Prototype property "graphicType" must be implemented.')
  }

  get referencedFrameOfReferenceUID() {
    throw new Error('Prototype property "referencedFrameOfReferenceUID" must be implemented.')
  }

  get fiducialUID() {
    throw new Error('Prototype property "fiducialUID" must be implemented.')
  }

}

class Point extends Scoord3D {
  
  
  constructor(coordinates) {
    super()
    if (!Array.isArray(coordinates)) {
      throw new Error('coordinates of Point must be an array')
    }
    if (coordinates.length !== 3) {
      throw new Error('coordinates of Point must be an array of length 3')
    }
    this[_coordinates] = coordinates
  }

  get graphicData() {
    return this[_coordinates]
  }

  get graphicType() {
    return 'POINT'
  }

}

class Multipoint extends Scoord3D {

  constructor(coordinates) {
    super()
    if (!Array.isArray(coordinates)) {
      throw new Error('coordinates of Multipoint must be an array')
    }
    if(coordinates.find(c => c.length !== 3)!== undefined){
      throw new Error('coordinates of Multipoint must be an array of length 3')
    }
    this[_coordinates] = coordinates
  }

  get graphicData() {
    return this[_coordinates]
  }

  get graphicType() {
    return 'MULTIPOINT'
  }

}

class Polyline extends Scoord3D {

  constructor(coordinates) {
    super()
    if (!Array.isArray(coordinates)) {
      throw new Error('coordinates of Polyline must be an array')
    }
    if(coordinates.find(c => c.length !== 3)!== undefined){
      throw new Error('coordinates of Polyline must be a list of points of length 3')
    }
    this[_coordinates] = coordinates
  }

  get graphicData() {
    /*
     * A polyline is defined as a series of connected line segments
     * with ordered vertices denoted by (column,row) pairs.
     * If the first and last vertices are the same it is a closed polygon.
     */
    return this[_coordinates]
  }

  get graphicType() {
    return 'POLYLINE'
  }

}

class Polygon extends Scoord3D {

  constructor(coordinates) {
    super()
    if (!Array.isArray(coordinates)) {
      throw new Error('coordinates of Polygon must be an array')
    }
    if(coordinates.find(c => c.length !== 3)!== undefined){
      throw new Error('coordinates of Polygon must be a list of points of length 3')
    }
    this[_coordinates] = coordinates
  }

  get graphicData() {
    /*
     * A polygon is defined a series of connected line segments with ordered vertices 
     * denoted by (x,y,z) triplets, where the first and last vertices shall be the same 
     * forming a polygon the points shall be coplanar
     */
    return this[_coordinates]
  }

  get graphicType() {
    return 'POLYGON'
  }

}

class Circle extends Scoord3D {

  constructor(coordinates) {
    super()
    if (!Array.isArray(coordinates)) {
      throw new Error('coordinates of Circle must be an array')
    }
    if (coordinates.length < 2) {
      throw new Error('coordinates of Circle must be an array of length 2')
    }
    if(coordinates.find(c => c.length !== 3)!== undefined){
      throw new Error('coordinates of Circle must be a list or size two with points of length 3')
    }
    this[_coordinates] = coordinates
  }

  get graphicData() {
    /*
     * A circle is defined by an array of flat coordinates
     * distributed into two arrays or xyz coordinates where the 
     * last coordinate is always 1
     */
    return this[_coordinates]
  }

  get graphicType() {
    return 'CIRCLE'
  }

}

class Ellipse extends Scoord3D {

  constructor(majorAxisEndpointCoordinates, minorAxisEndpointCoordinates) {
    super()
    if (!Array.isArray(majorAxisEndpointCoordinates)) {
      throw new Error('majorAxisEndpointCoordinates of Ellipse must be an array')
    }
    if (!Array.isArray(minorAxisEndpointCoordinates)) {
      throw new Error('minorAxisEndpointCoordinates of Ellipse must be an array')
    }
    if (majorAxisEndpointCoordinates.length !== 2) {
      throw new Error('majorAxisEndpointCoordinates coordinates of Ellipse must be an array of length 2')
    }
    if (minorAxisEndpointCoordinates.length !== 2) {
      throw new Error('minorAxisEndpointCoordinates coordinates of Ellipse must be an array of length 2')
    }
    this[_majorAxisEndpointCoordinates] = majorAxisEndpointCoordinates
    this[_minorAxisEndpointCoordinates] = minorAxisEndpointCoordinates
  }

  get graphicData() {
    /*
     * An ellipse defined by four pixel (column,row) pairs distributed into two arrays.
     * The first array contains two points that represents the major axis.
     * The second array contains two points that represents the minor axis.
     */
    return [
      ...this[_majorAxisEndpointCoordinates],
      ...this[_minorAxisEndpointCoordinates]
    ]
  }

  get graphicType() {
    return 'ELLIPSE'
  }

}

export { Point, Multipoint, Polyline, Polygon, Circle, Ellipse }

