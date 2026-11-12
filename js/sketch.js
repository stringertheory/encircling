/* Touch drawing for people playing Encircling: how gestures shape a draft
circle, and how the view of the paper pans and zooms. Pure functions with
no page in sight, so they run in Node for tests; play.js wires them up.

Positions are on the paper, in the game's units, unless named screen_.
A view maps paper to screen: screen = paper * scale + (x, y). */
(function (root) {

  var DEFAULT_DIAMETER = {big: 6.5, small: 1.4}; // centimeters
  var HANDLE_PX = 14; // screen pixels, the resize handle's radius
  var HANDLE_REACH_PX = 30; // how far from the handle a touch still grabs it
  var GRAB_PX = 24; // a touch this close outside a draft still moves it
  var MAX_PX_PER_CM = 90; // the furthest anyone needs to zoom in

  var clamp = function (value, low, high) {
    return Math.min(high, Math.max(low, value));
  };

  var distance = function (a, b) {
    return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
  };

  // the radii a circle of this kind may have, from the rules' diameters
  var radius_limits = function (game, kind, diameters) {
    var range = diameters[kind];
    return [range[0] * game.scale / 2, range[1] * game.scale / 2];
  };

  // The resize handle sits off the draft's line, down and to the right, and
  // never closer to the center than a finger can tell apart.
  var handle_of = function (draft, scale) {
    var reach = Math.max(draft.r, (HANDLE_PX * 2) / scale) +
      HANDLE_PX / 2 / scale;
    return {
      x: draft.x + reach * Math.SQRT1_2,
      y: draft.y + reach * Math.SQRT1_2
    };
  };

  /* A finger coming down starts one of three gestures:
       resize  on the handle, scaling the draft by how far the finger moves
       move    on or near the draft, dragging it by however the finger moves
       draw    anywhere else; a big circle is drawn from its center out,
               and a small one appears under the finger, ready to drag */
  var begin = function (options) {
    var draft = options.draft;
    var point = options.point;
    var scale = options.scale;
    var limits = options.limits;
    if (draft && draft.kind === options.kind) {
      if (distance(point, handle_of(draft, scale)) <= HANDLE_REACH_PX / scale) {
        return {mode: 'resize', start: draft, from: point, limits: limits};
      }
      if (distance(point, draft) <= draft.r + GRAB_PX / scale) {
        return {mode: 'move', start: draft, from: point, limits: limits};
      }
    }
    if (options.kind === 'big') {
      return {mode: 'draw', start: draft, center: point, limits: limits,
              kind: 'big'};
    }
    var fresh = {
      x: point.x, y: point.y, kind: 'small',
      r: clamp(options.default_r, limits[0], limits[1])
    };
    return {mode: 'move', start: fresh, from: point, limits: limits,
            fresh: true};
  };

  // the draft as the finger has shaped it so far
  var follow = function (gesture, point) {
    var limits = gesture.limits;
    if (gesture.mode === 'draw') {
      return {
        x: gesture.center.x, y: gesture.center.y, kind: gesture.kind,
        r: clamp(distance(gesture.center, point), limits[0], limits[1])
      };
    }
    var start = gesture.start;
    if (gesture.mode === 'move') {
      return {
        x: start.x + point.x - gesture.from.x,
        y: start.y + point.y - gesture.from.y,
        r: start.r, kind: start.kind
      };
    }
    var reach = distance(start, gesture.from);
    var r = reach > 0 ? start.r * distance(start, point) / reach : start.r;
    return {x: start.x, y: start.y, kind: start.kind,
            r: clamp(r, limits[0], limits[1])};
  };

  // what to keep if a second finger turns the gesture into a pinch
  var abandon = function (gesture) {
    return gesture.fresh ? null : gesture.start || null;
  };

  var to_paper = function (view, screen_x, screen_y) {
    return {x: (screen_x - view.x) / view.scale,
            y: (screen_y - view.y) / view.scale};
  };

  // the whole paper, centered in the box with a margin
  var fit = function (paper, box, margin) {
    var scale = Math.min((box.width - 2 * margin) / paper.width,
                         (box.height - 2 * margin) / paper.height);
    return {
      scale: scale,
      x: box.left + (box.width - paper.width * scale) / 2,
      y: box.top + (box.height - paper.height * scale) / 2,
      min_scale: scale * 0.8,
      max_scale: Math.max(scale, MAX_PX_PER_CM / paper.scale)
    };
  };

  // zooms by a factor, keeping the paper under the screen point still
  var zoom_at = function (view, factor, screen_x, screen_y) {
    var scale = clamp(view.scale * factor, view.min_scale, view.max_scale);
    var anchor = to_paper(view, screen_x, screen_y);
    return {
      scale: scale,
      x: screen_x - anchor.x * scale,
      y: screen_y - anchor.y * scale,
      min_scale: view.min_scale,
      max_scale: view.max_scale
    };
  };

  // Two fingers that started at a0 and b0 and are now at a and b: the
  // paper under them follows, zooming and panning together.
  var pinch = function (view, a0, b0, a, b) {
    var start_gap = distance(a0, b0);
    var factor = start_gap > 0 ? distance(a, b) / start_gap : 1;
    var mid0 = {x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2};
    var mid = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
    var zoomed = zoom_at(view, factor, mid0.x, mid0.y);
    zoomed.x += mid.x - mid0.x;
    zoomed.y += mid.y - mid0.y;
    return zoomed;
  };

  var api = {
    DEFAULT_DIAMETER: DEFAULT_DIAMETER,
    HANDLE_PX: HANDLE_PX,
    radius_limits: radius_limits,
    handle_of: handle_of,
    begin: begin,
    follow: follow,
    abandon: abandon,
    to_paper: to_paper,
    fit: fit,
    zoom_at: zoom_at,
    pinch: pinch
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Sketch = api;
  }
})(this);
