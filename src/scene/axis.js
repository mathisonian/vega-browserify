var dl = require('datalib'),
    Tuple = require('vega-dataflow').Tuple,
    parseMark = require('../parse/mark');

var TIME    = 'time',
    UTC     = 'utc',
    STRING  = 'string',
    ORDINAL = 'ordinal',
    NUMBER  = 'number';

function axs(model) {
  var scale,
      config = model.config(),
      orient = config.axis.orient,
      offset = 0,
      titleOffset = config.axis.titleOffset,
      axisDef = {},
      layer = 'front',
      grid = false,
      title = null,
      tickMajorSize = config.axis.tickSize,
      tickMinorSize = config.axis.tickSize,
      tickEndSize = config.axis.tickSize,
      tickPadding = config.axis.padding,
      tickValues = null,
      tickFormatString = null,
      tickFormatType = null,
      tickSubdivide = 0,
      tickCount = config.axis.ticks,
      gridLineStyle = {},
      tickLabelStyle = {},
      majorTickStyle = {},
      minorTickStyle = {},
      titleStyle = {},
      domainStyle = {},
      m = { // Axis marks as references for updates
        gridLines:  {},
        majorTicks: {},
        minorTicks: {},
        tickLabels: {},
        domain: {},
        title:  {}
      };

  var axis = {};

  function reset() {
    axisDef.type = null;
  }

  function ingest(d) {
    return {data: d};
  }

  function getTickFormat() {
    var formatType = tickFormatType || inferFormatType();
    return getFormatter(formatType, tickFormatString);
  }

  function inferFormatType() {
    switch (scale.type) {
      case TIME:    return TIME;
      case UTC:     return UTC;
      case ORDINAL: return STRING;
      default:      return NUMBER;
    }
  }

  // Adapted from d3 log scale
  // TODO customize? replace with range-size-aware filtering?
  function logFilter(domain, count, f) {
    if (count == null) return f;
    var base = scale.base(),
        k = Math.min(base, scale.ticks().length / count),
        v = domain[0] > 0 ? (e = 1e-12, Math.ceil) : (e = -1e-12, Math.floor),
        e;
    function log(x) {
      return (domain[0] < 0 ?
        -Math.log(x > 0 ? 0 : -x) :
        Math.log(x < 0 ? 0 : x)) / Math.log(base);
    }
    function pow(x) {
      return domain[0] < 0 ? -Math.pow(base, -x) : Math.pow(base, x);
    }
    return function(d) {
      return pow(v(log(d) + e)) / d >= k ? f(d) : '';
    };
  }

  function getFormatter(formatType, str) {
    var fmt = dl.format,
        log = scale.type === 'log',
        domain, f;

    switch (formatType) {
      case NUMBER:
         domain = scale.domain();
         f = fmt.auto.number(domain, tickCount, str || (log ? '.1r' : null));
         return log ? logFilter(domain, tickCount, f) : f;
      case TIME: return (str ? fmt : fmt.auto).time(str);
      case UTC:  return (str ? fmt : fmt.auto).utc(str);
      default:   return String;
    }
  }
  
  function getTicks(format) {
    var major = tickValues || (scale.ticks ? scale.ticks(tickCount) : scale.domain()),
        minor = axisSubdivide(scale, major, tickSubdivide).map(ingest);
    major = major.map(function(d) { return (d = ingest(d), d.label = format(d.data), d); });
    return [major, minor];
  }

  axis.def = function() {
    if (!axisDef.type) axis_def(scale);

    var ticks = getTicks(getTickFormat());
    var tdata = title ? [title].map(ingest) : [];

    axisDef.marks[0].from = function() { return grid ? ticks[0] : []; };
    axisDef.marks[1].from = function() { return ticks[0]; };
    axisDef.marks[2].from = function() { return ticks[1]; };
    axisDef.marks[3].from = axisDef.marks[1].from;
    axisDef.marks[4].from = function() { return [1]; };
    axisDef.marks[5].from = function() { return tdata; };
    axisDef.offset = offset;
    axisDef.orient = orient;
    axisDef.layer = layer;

    return axisDef;
  };

  function axis_def(scale) {
    // setup scale mapping
    var newScale, oldScale, range;
    if (scale.type === ORDINAL) {
      newScale = {scale: scale.scaleName, offset: 0.5 + scale.rangeBand()/2};
      oldScale = newScale;
    } else {
      newScale = {scale: scale.scaleName, offset: 0.5};
      oldScale = {scale: scale.scaleName+':prev', offset: 0.5};
    }
    range = axisScaleRange(scale);

    // setup axis marks
    dl.extend(m.gridLines, axisTicks(config));
    dl.extend(m.majorTicks, axisTicks(config));
    dl.extend(m.minorTicks, axisTicks(config));
    dl.extend(m.tickLabels, axisTickLabels(config));
    dl.extend(m.domain, axisDomain(config));
    dl.extend(m.title, axisTitle(config));
    m.gridLines.properties.enter.stroke = {value: config.axis.gridColor};
    m.gridLines.properties.enter.strokeOpacity = {value: config.axis.gridOpacity};

    // extend axis marks based on axis orientation
    axisTicksExtend(orient, m.gridLines, oldScale, newScale, Infinity);
    axisTicksExtend(orient, m.majorTicks, oldScale, newScale, tickMajorSize);
    axisTicksExtend(orient, m.minorTicks, oldScale, newScale, tickMinorSize);
    axisLabelExtend(orient, m.tickLabels, oldScale, newScale, tickMajorSize, tickPadding);

    axisDomainExtend(orient, m.domain, range, tickEndSize);
    axisTitleExtend(orient, m.title, range, titleOffset); // TODO get offset
    
    // add / override custom style properties
    dl.extend(m.gridLines.properties.update, gridLineStyle);
    dl.extend(m.majorTicks.properties.update, majorTickStyle);
    dl.extend(m.minorTicks.properties.update, minorTickStyle);
    dl.extend(m.tickLabels.properties.update, tickLabelStyle);
    dl.extend(m.domain.properties.update, domainStyle);
    dl.extend(m.title.properties.update, titleStyle);

    var marks = [m.gridLines, m.majorTicks, m.minorTicks, m.tickLabels, m.domain, m.title];
    dl.extend(axisDef, {
      type: 'group',
      interactive: false,
      properties: { 
        enter: {
          encode: axisUpdate,
          scales: [scale.scaleName],
          signals: [], data: []
        },
        update: {
          encode: axisUpdate,
          scales: [scale.scaleName],
          signals: [], data: []
        }
      }
    });

    axisDef.marks = marks.map(function(m) { return parseMark(model, m); });
  }

  axis.scale = function(x) {
    if (!arguments.length) return scale;
    if (scale !== x) { scale = x; reset(); }
    return axis;
  };

  axis.orient = function(x) {
    if (!arguments.length) return orient;
    if (orient !== x) {
      orient = x in axisOrients ? x + '' : config.axis.orient;
      reset();
    }
    return axis;
  };

  axis.title = function(x) {
    if (!arguments.length) return title;
    if (title !== x) { title = x; reset(); }
    return axis;
  };

  axis.tickCount = function(x) {
    if (!arguments.length) return tickCount;
    tickCount = x;
    return axis;
  };

  axis.tickValues = function(x) {
    if (!arguments.length) return tickValues;
    tickValues = x;
    return axis;
  };

  axis.tickFormat = function(x) {
    if (!arguments.length) return tickFormatString;
    if (tickFormatString !== x) {
      tickFormatString = x;
      reset();
    }
    return axis;
  };

  axis.tickFormatType = function(x) {
    if (!arguments.length) return tickFormatType;
    if (tickFormatType !== x) {
      tickFormatType = x;
      reset();
    }
    return axis;
  };

  axis.tickSize = function(x, y) {
    if (!arguments.length) return tickMajorSize;
    var n = arguments.length - 1,
        major = +x,
        minor = n > 1 ? +y : tickMajorSize,
        end   = n > 0 ? +arguments[n] : tickMajorSize;

    if (tickMajorSize !== major ||
        tickMinorSize !== minor ||
        tickEndSize !== end) {
      reset();
    }

    tickMajorSize = major;
    tickMinorSize = minor;
    tickEndSize = end;
    return axis;
  };

  axis.tickSubdivide = function(x) {
    if (!arguments.length) return tickSubdivide;
    tickSubdivide = +x;
    return axis;
  };
  
  axis.offset = function(x) {
    if (!arguments.length) return offset;
    offset = dl.isObject(x) ? x : +x;
    return axis;
  };

  axis.tickPadding = function(x) {
    if (!arguments.length) return tickPadding;
    if (tickPadding !== +x) { tickPadding = +x; reset(); }
    return axis;
  };

  axis.titleOffset = function(x) {
    if (!arguments.length) return titleOffset;
    if (titleOffset !== +x) { titleOffset = +x; reset(); }
    return axis;
  };

  axis.layer = function(x) {
    if (!arguments.length) return layer;
    if (layer !== x) { layer = x; reset(); }
    return axis;
  };

  axis.grid = function(x) {
    if (!arguments.length) return grid;
    if (grid !== x) { grid = x; reset(); }
    return axis;
  };

  axis.gridLineProperties = function(x) {
    if (!arguments.length) return gridLineStyle;
    if (gridLineStyle !== x) { gridLineStyle = x; }
    return axis;
  };

  axis.majorTickProperties = function(x) {
    if (!arguments.length) return majorTickStyle;
    if (majorTickStyle !== x) { majorTickStyle = x; }
    return axis;
  };

  axis.minorTickProperties = function(x) {
    if (!arguments.length) return minorTickStyle;
    if (minorTickStyle !== x) { minorTickStyle = x; }
    return axis;
  };

  axis.tickLabelProperties = function(x) {
    if (!arguments.length) return tickLabelStyle;
    if (tickLabelStyle !== x) { tickLabelStyle = x; }
    return axis;
  };

  axis.titleProperties = function(x) {
    if (!arguments.length) return titleStyle;
    if (titleStyle !== x) { titleStyle = x; }
    return axis;
  };

  axis.domainProperties = function(x) {
    if (!arguments.length) return domainStyle;
    if (domainStyle !== x) { domainStyle = x; }
    return axis;
  };
  
  axis.reset = function() { 
    reset(); 
    return axis; 
  };

  return axis;
}

var axisOrients = {top: 1, right: 1, bottom: 1, left: 1};

function axisSubdivide(scale, ticks, m) {
  var subticks = [];
  if (m && ticks.length > 1) {
    var extent = axisScaleExtent(scale.domain()),
        i = -1,
        n = ticks.length,
        d = (ticks[1] - ticks[0]) / ++m,
        j,
        v;
    while (++i < n) {
      for (j = m; --j > 0;) {
        if ((v = +ticks[i] - j * d) >= extent[0]) {
          subticks.push(v);
        }
      }
    }
    for (--i, j = 0; ++j < m && (v = +ticks[i] + j * d) < extent[1];) {
      subticks.push(v);
    }
  }
  return subticks;
}

function axisScaleExtent(domain) {
  var start = domain[0], stop = domain[domain.length - 1];
  return start < stop ? [start, stop] : [stop, start];
}

function axisScaleRange(scale) {
  return scale.rangeExtent ?
    scale.rangeExtent() :
    axisScaleExtent(scale.range());
}

var axisAlign = {
  bottom: 'center',
  top: 'center',
  left: 'right',
  right: 'left'
};

var axisBaseline = {
  bottom: 'top',
  top: 'bottom',
  left: 'middle',
  right: 'middle'
};

function axisLabelExtend(orient, labels, oldScale, newScale, size, pad) {
  size = Math.max(size, 0) + pad;
  if (orient === 'left' || orient === 'top') {
    size *= -1;
  }  
  if (orient === 'top' || orient === 'bottom') {
    dl.extend(labels.properties.enter, {
      x: oldScale,
      y: {value: size},
    });
    dl.extend(labels.properties.update, {
      x: newScale,
      y: {value: size},
      align: {value: 'center'},
      baseline: {value: axisBaseline[orient]}
    });
  } else {
    dl.extend(labels.properties.enter, {
      x: {value: size},
      y: oldScale,
    });
    dl.extend(labels.properties.update, {
      x: {value: size},
      y: newScale,
      align: {value: axisAlign[orient]},
      baseline: {value: 'middle'}
    });
  }
}

function axisTicksExtend(orient, ticks, oldScale, newScale, size) {
  var sign = (orient === 'left' || orient === 'top') ? -1 : 1;
  if (size === Infinity) {
    size = (orient === 'top' || orient === 'bottom') ?
      {field: {group: 'height', level: 2}, mult: -sign} :
      {field: {group: 'width',  level: 2}, mult: -sign};
  } else {
    size = {value: sign * size};
  }
  if (orient === 'top' || orient === 'bottom') {
    dl.extend(ticks.properties.enter, {
      x:  oldScale,
      y:  {value: 0},
      y2: size
    });
    dl.extend(ticks.properties.update, {
      x:  newScale,
      y:  {value: 0},
      y2: size
    });
    dl.extend(ticks.properties.exit, {
      x:  newScale,
    });        
  } else {
    dl.extend(ticks.properties.enter, {
      x:  {value: 0},
      x2: size,
      y:  oldScale
    });
    dl.extend(ticks.properties.update, {
      x:  {value: 0},
      x2: size,
      y:  newScale
    });
    dl.extend(ticks.properties.exit, {
      y:  newScale,
    });
  }
}

function axisTitleExtend(orient, title, range, offset) {
  var mid = ~~((range[0] + range[1]) / 2),
      sign = (orient === 'top' || orient === 'left') ? -1 : 1;
  
  if (orient === 'bottom' || orient === 'top') {
    dl.extend(title.properties.update, {
      x: {value: mid},
      y: {value: sign*offset},
      angle: {value: 0}
    });
  } else {
    dl.extend(title.properties.update, {
      x: {value: sign*offset},
      y: {value: mid},
      angle: {value: orient === 'left' ? -90 : 90}
    });
  }
}

function axisDomainExtend(orient, domain, range, size) {
  var path;
  if (orient === 'top' || orient === 'left') {
    size = -1 * size;
  }
  if (orient === 'bottom' || orient === 'top') {
    path = 'M' + range[0] + ',' + size + 'V0H' + range[1] + 'V' + size;
  } else {
    path = 'M' + size + ',' + range[0] + 'H0V' + range[1] + 'H' + size;
  }
  domain.properties.update.path = {value: path};
}

function axisUpdate(item, group, trans) {
  var o = trans ? {} : item,
      offset = item.mark.def.offset,
      orient = item.mark.def.orient,
      width  = group.width,
      height = group.height; // TODO fallback to global w,h?

  if (dl.isArray(offset)) {
    var ofx = offset[0],
        ofy = offset[1];

    switch (orient) {
      case 'left':   { Tuple.set(o, 'x', -ofx); Tuple.set(o, 'y', ofy); break; }
      case 'right':  { Tuple.set(o, 'x', width + ofx); Tuple.set(o, 'y', ofy); break; }
      case 'bottom': { Tuple.set(o, 'x', ofx); Tuple.set(o, 'y', height + ofy); break; }
      case 'top':    { Tuple.set(o, 'x', ofx); Tuple.set(o, 'y', -ofy); break; }
      default:       { Tuple.set(o, 'x', ofx); Tuple.set(o, 'y', ofy); }
    }
  } else {
    if (dl.isObject(offset)) {
      offset = -group.scale(offset.scale)(offset.value);
    }

    switch (orient) {
      case 'left':   { Tuple.set(o, 'x', -offset); Tuple.set(o, 'y', 0); break; }
      case 'right':  { Tuple.set(o, 'x', width + offset); Tuple.set(o, 'y', 0); break; }
      case 'bottom': { Tuple.set(o, 'x', 0); Tuple.set(o, 'y', height + offset); break; }
      case 'top':    { Tuple.set(o, 'x', 0); Tuple.set(o, 'y', -offset); break; }
      default:       { Tuple.set(o, 'x', 0); Tuple.set(o, 'y', 0); }
    }
  }

  if (trans) trans.interpolate(item, o);
  return true;
}

function axisTicks(config) {
  return {
    type: 'rule',
    interactive: false,
    key: 'data',
    properties: {
      enter: {
        stroke: {value: config.axis.tickColor},
        strokeWidth: {value: config.axis.tickWidth},
        opacity: {value: 1e-6}
      },
      exit: { opacity: {value: 1e-6} },
      update: { opacity: {value: 1} }
    }
  };
}

function axisTickLabels(config) {
  return {
    type: 'text',
    interactive: true,
    key: 'data',
    properties: {
      enter: {
        fill: {value: config.axis.tickLabelColor},
        font: {value: config.axis.tickLabelFont},
        fontSize: {value: config.axis.tickLabelFontSize},
        opacity: {value: 1e-6},
        text: {field: 'label'}
      },
      exit: { opacity: {value: 1e-6} },
      update: { opacity: {value: 1} }
    }
  };
}

function axisTitle(config) {
  return {
    type: 'text',
    interactive: true,
    properties: {
      enter: {
        font: {value: config.axis.titleFont},
        fontSize: {value: config.axis.titleFontSize},
        fontWeight: {value: config.axis.titleFontWeight},
        fill: {value: config.axis.titleColor},
        align: {value: 'center'},
        baseline: {value: 'middle'},
        text: {field: 'data'}
      },
      update: {}
    }
  };
}

function axisDomain(config) {
  return {
    type: 'path',
    interactive: false,
    properties: {
      enter: {
        x: {value: 0.5},
        y: {value: 0.5},
        stroke: {value: config.axis.axisColor},
        strokeWidth: {value: config.axis.axisWidth}
      },
      update: {}
    }
  };
}

module.exports = axs;
