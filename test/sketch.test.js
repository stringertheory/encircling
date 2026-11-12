var test = require('node:test');
var assert = require('node:assert');
var Encircling = require('../js/game.js');
var Sketch = require('../js/sketch.js');

var game = Encircling.create_shared_game({});
var SCALE = 2; // screen pixels per paper unit
var limits = function (kind) {
  return Sketch.radius_limits(game, kind, Encircling.DIAMETERS);
};
var begin = function (draft, point, kind) {
  return Sketch.begin({
    draft: draft, point: point, kind: kind, scale: SCALE,
    limits: limits(kind),
    default_r: Sketch.DEFAULT_DIAMETER[kind] * game.scale / 2
  });
};

test('circles are limited to the sizes the rules give', function () {
  assert.deepEqual(limits('big'), [5 * 14 / 2, 10 * 14 / 2]);
  assert.deepEqual(limits('small'), [1 * 14 / 2, 2 * 14 / 2]);
});

test('a big circle is drawn out from its center', function () {
  var gesture = begin(null, {x: 200, y: 200}, 'big');
  assert.equal(gesture.mode, 'draw');
  assert.deepEqual(Sketch.follow(gesture, {x: 250, y: 200}),
                   {x: 200, y: 200, r: 50, kind: 'big'});
  assert.equal(Sketch.follow(gesture, {x: 201, y: 200}).r, limits('big')[0]);
  assert.equal(Sketch.follow(gesture, {x: 400, y: 200}).r, limits('big')[1]);
});

test('dragging on or near a draft moves it without jumping', function () {
  var draft = {x: 200, y: 200, r: 50, kind: 'big'};
  [{x: 230, y: 210}, {x: 200 + 50 + 20 / SCALE, y: 200}].forEach(function (at) {
    var gesture = begin(draft, at, 'big');
    assert.equal(gesture.mode, 'move');
    assert.deepEqual(Sketch.follow(gesture, at), draft);
    assert.deepEqual(Sketch.follow(gesture, {x: at.x + 15, y: at.y - 5}),
                     {x: 215, y: 195, r: 50, kind: 'big'});
  });
  assert.equal(begin(draft, {x: 200 + 50 + 40 / SCALE, y: 170}, 'big').mode,
               'draw');
});

test('the handle resizes a draft in proportion to the drag', function () {
  var draft = {x: 200, y: 200, r: 50, kind: 'big'};
  var handle = Sketch.handle_of(draft, SCALE);
  var gesture = begin(draft, handle, 'big');
  assert.equal(gesture.mode, 'resize');
  var further = {x: 200 + (handle.x - 200) * 1.2, y: 200 + (handle.y - 200) * 1.2};
  var resized = Sketch.follow(gesture, further);
  assert.ok(Math.abs(resized.r - 60) < 1e-9);
  assert.equal(resized.x, 200);
  assert.equal(Sketch.follow(gesture, {x: 201, y: 201}).r, limits('big')[0]);
});

test('a small draft keeps its handle where a finger can reach it', function () {
  var small = {x: 100, y: 100, r: 9, kind: 'small'};
  var handle = Sketch.handle_of(small, SCALE);
  var screen_gap = Math.hypot(handle.x - 100, handle.y - 100) * SCALE;
  assert.ok(screen_gap >= 2 * Sketch.HANDLE_PX, 'gap ' + screen_gap);
  assert.equal(begin(small, handle, 'small').mode, 'resize');
});

test('a small circle appears under the finger, ready to drag', function () {
  var gesture = begin(null, {x: 300, y: 300}, 'small');
  assert.equal(gesture.mode, 'move');
  assert.deepEqual(gesture.start,
                   {x: 300, y: 300, kind: 'small', r: 1.4 * 14 / 2});
  assert.deepEqual(Sketch.follow(gesture, {x: 310, y: 300}),
                   {x: 310, y: 300, kind: 'small', r: 1.4 * 14 / 2});
});

test('a draft of the other kind is replaced, not moved', function () {
  var big = {x: 200, y: 200, r: 50, kind: 'big'};
  var gesture = begin(big, {x: 200, y: 200}, 'small');
  assert.equal(gesture.start.kind, 'small');
});

test('a pinch undoes what its first finger started', function () {
  var draft = {x: 200, y: 200, r: 50, kind: 'big'};
  assert.deepEqual(Sketch.abandon(begin(draft, {x: 210, y: 200}, 'big')), draft);
  assert.deepEqual(Sketch.abandon(begin(draft, {x: 400, y: 400}, 'big')), draft);
  assert.equal(Sketch.abandon(begin(null, {x: 400, y: 400}, 'big')), null);
  assert.equal(Sketch.abandon(begin(null, {x: 400, y: 400}, 'small')), null);
});

var phone = {left: 0, top: 60, width: 390, height: 640};
var paper = {width: game.width, height: game.height, scale: game.scale};

test('the paper is fitted to the screen with a margin', function () {
  var view = Sketch.fit(paper, phone, 12);
  var left = view.x;
  var top = view.y;
  var right = view.x + paper.width * view.scale;
  var bottom = view.y + paper.height * view.scale;
  assert.ok(left >= 12 - 1e-9 && right <= 390 - 12 + 1e-9);
  assert.ok(top >= 60 + 12 - 1e-9 && bottom <= 700 - 12 + 1e-9);
  assert.ok(Math.abs((left + right) / 2 - 195) < 1e-9);
  assert.ok(Math.abs((top + bottom) / 2 - 380) < 1e-9);
  // a centimeter is far too small to draw on until zoomed
  assert.ok(view.max_scale * game.scale >= 90);
});

test('zooming keeps the paper under the fingers still', function () {
  var view = Sketch.fit(paper, phone, 12);
  var under = Sketch.to_paper(view, 100, 300);
  var zoomed = Sketch.zoom_at(view, 2, 100, 300);
  assert.ok(Math.abs(zoomed.scale - 2 * view.scale) < 1e-9);
  var still = Sketch.to_paper(zoomed, 100, 300);
  assert.ok(Math.abs(still.x - under.x) < 1e-9);
  assert.ok(Math.abs(still.y - under.y) < 1e-9);
  assert.equal(Sketch.zoom_at(view, 1000, 0, 0).scale, view.max_scale);
  assert.equal(Sketch.zoom_at(view, 0.001, 0, 0).scale, view.min_scale);
});

test('a pinch zooms by the spread of the fingers and pans with them', function () {
  var view = Sketch.fit(paper, phone, 12);
  var a0 = {x: 150, y: 300};
  var b0 = {x: 250, y: 300};
  var spread = Sketch.pinch(view, a0, b0, {x: 100, y: 300}, {x: 300, y: 300});
  assert.ok(Math.abs(spread.scale - 2 * view.scale) < 1e-9);
  var middle = Sketch.to_paper(view, 200, 300);
  var after = Sketch.to_paper(spread, 200, 300);
  assert.ok(Math.abs(after.x - middle.x) < 1e-9);
  var slid = Sketch.pinch(view, a0, b0, {x: 170, y: 340}, {x: 270, y: 340});
  assert.equal(slid.scale, view.scale);
  assert.ok(Math.abs(slid.x - (view.x + 20)) < 1e-9);
  assert.ok(Math.abs(slid.y - (view.y + 40)) < 1e-9);
});
