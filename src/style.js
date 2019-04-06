import {Fill, Stroke, Text, Style as OpenLayersStyle, Circle as CircleStyle} from 'ol/style.js';

const _style = Symbol('style')

class ToolStyle {  
  
    constructor(styleOptions) {

      const style = new OpenLayersStyle({
        stroke: new Stroke({
          color: styleOptions.stroke.color !== undefined ? styleOptions.stroke.color : 'green',
          width: styleOptions.stroke.width !== undefined ? styleOptions.stroke.width : 1
        }),
        fill: new Fill({
          color: styleOptions.fill.color !== undefined ? styleOptions.fill.color : 'rgba(0, 255, 0, 0.1)'
        }),
        image: new CircleStyle({
          radius: styleOptions.circle.radius !== undefined ? styleOptions.circle.radius : 5,
          fill: new Fill({
            color: styleOptions.circle.color !== undefined ? styleOptions.circle.color : 'green'
          })
        }),
        text : styleOptions.text !== undefined ? new Text({
          font: styleOptions.text.font !== undefined ? styleOptions.text.font : '10px sans-serif',
          textAlign : styleOptions.text.textAlign !== undefined ? styleOptions.text.textAlign : 'center',  
          text : styleOptions.text.text !== undefined ? styleOptions.text.text : '',
          offsetX : styleOptions.text.offsetX !== undefined ? styleOptions.text.offsetX : 0,
          offsetY : styleOptions.text.offsetY !== undefined ? styleOptions.text.offsetY : 0,
          scale : styleOptions.text.scale !== undefined ? styleOptions.text.scale : 1,
          textBaseline : styleOptions.text.textBaseline !== undefined ? styleOptions.text.textBaseline : 'center',
          fill : new Fill({
            color: styleOptions.text.fillColor !== undefined ? styleOptions.text.fillColor : '#333'
          })
        }) : new Text()
      })

      this[_style] = style

    }

    getStyle(){
      return this[_style]
    }
  
  }

export { ToolStyle };