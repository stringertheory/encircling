/* Draws a game of Encircling, played by js/game.js:

http://www.conditionaldesign.org/workshops/encircling/

Add ?seed=123 to the URL to reproduce a drawing, or ?still to skip the
animation.
*/
var scale = 14; // pixels per centimeter
var stroke_width = 1;
var seconds_per_step = 0.08;

// set up player colors
var players = [
  new Color(237 / 255,  87 / 255,   0 / 255), // orange
  new Color( 34 / 255, 174 / 255,  58 / 255), // green
  new Color( 52 / 255, 189 / 255, 238 / 255), // blue
  new Color( 42 / 255,  42 / 255,  42 / 255), // gray
];

var seed_in_url = /[?&]seed=(\d+)/.exec(window.location.search);
var seed = seed_in_url ? Number(seed_in_url[1]) : Date.now();
var still = /[?&]still\b/.test(window.location.search);

var game = Encircling.play_drawing({
  width: view.bounds.width,
  height: view.bounds.height,
  scale: scale,
  seed: seed,
  players: players.length
});
console.log('seed', seed, 'turns', game.turns.length);

// fills go underneath, so they never cover a line
var fills = project.activeLayer;
var lines = new Layer();

var draw_circle = function (circle) {
  return new Path.Circle({
    center: new Point(circle.x, circle.y),
    radius: circle.r,
    strokeWidth: stroke_width,
    strokeColor: players[circle.color]
  });
};

// a completed set is colored in, except where other sets intersect it
var fill_completed = function (big) {
  fills.activate();
  var area = draw_circle(big);
  _.each(Encircling.neighbors_of(big), function (neighbor) {
    var cutter = draw_circle(neighbor);
    var remaining = area.subtract(cutter);
    cutter.remove();
    area.remove();
    area = remaining;
  });
  area.strokeColor = null;
  area.fillColor = players[big.completed_by];
  lines.activate();
};

var draw_step = function (step) {
  if (step.fill) {
    fill_completed(step.fill);
  } else {
    draw_circle(step.circle);
  }
};

var steps = Encircling.timeline(game);
var next_step = 0;

if (still) {
  _.each(steps, draw_step);
  next_step = steps.length;
}

function onFrame(event) {
  var due = Math.floor(event.time / seconds_per_step);
  while (next_step < steps.length && next_step <= due) {
    draw_step(steps[next_step]);
    next_step += 1;
  }
}
