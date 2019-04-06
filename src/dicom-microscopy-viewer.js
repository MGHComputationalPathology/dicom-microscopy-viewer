import { VLWholeSlideMicroscopyImageViewer } from './api.js';
import { ROI } from './roi.js';
import { ToolStyle } from './style.js'
import {
  Point,
  Multipoint,
  Polyline,
  Polygon,
  Circle,
  Ellipse,
} from './scoord3d.js';

let api = {
  VLWholeSlideMicroscopyImageViewer,
};
let scoord3d = {
  Point,
  Multipoint,
  Polyline,
  Polygon,
  Circle,
  Ellipse
};
let roi = {
  ROI,
}

let style = {
  ToolStyle
}

export { api, scoord3d, roi, style };
