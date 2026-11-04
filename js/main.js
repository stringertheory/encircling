/* Draws a game of Encircling, played by js/game.js:

http://www.conditionaldesign.org/workshops/encircling/

Add ?seed=123 to the URL to reproduce a drawing.
*/
var scale = 14; // pixels per centimeter
var stroke_width = 1;

// set up player colors
var players = [
  new Color(237 / 255,  87 / 255,   0 / 255), // orange
  new Color( 34 / 255, 174 / 255,  58 / 255), // green
  new Color( 52 / 255, 189 / 255, 238 / 255), // blue
  new Color( 42 / 255,  42 / 255,  42 / 255), // gray
];

var seed_in_url = /[?&]seed=(\d+)/.exec(window.location.search);
var seed = seed_in_url ? Number(seed_in_url[1]) : Date.now();

var game = Encircling.create_game({
  width: view.bounds.width,
  height: view.bounds.height,
  scale: scale,
  seed: seed,
  players: players.length
});
Encircling.play(game);
console.log('seed', seed, 'turns', game.turns.length);

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
};

_.each(_.filter(game.bigs, function (big) {
  return big.completed_by !== null;
}), fill_completed);

_.each(game.bigs, draw_circle);
_.each(game.smalls, draw_circle);
