/* Trying to reproduce something like:

http://www.conditionaldesign.org/workshops/encircling/

*/
var scale = 5; // pixels per centimeter

var small_radius = function () {
  return _.random(1 * scale, 2 * scale);
}

var large_radius = function () {
  return _.random(5 * scale, 10 * scale);
}

var n_iterations = 0;
var max_iterations = 200;
var incomplete = function () {
  n_iterations += 1;
  if (n_iterations > max_iterations) {
    return false;
  } else {
    return true;
  }
}

var initial_turn = function (player) {
  var bounds = view.bounds;
  var radius = small_radius();
  var polygon = new Path.Circle({
    center: new Point(
      _.random(bounds.x + radius, bounds.x + bounds.width - radius),
      _.random(bounds.y + radius, bounds.y + bounds.height - radius)
    ),
    radius: radius,
    strokeWidth: 2,
    strokeColor: player
  });
}

var turn = function (player) {
  var bounds = view.bounds;
  var radius = small_radius();
  var polygon = new Path.Circle({
    center: new Point(
      _.random(bounds.x + radius, bounds.x + bounds.width - radius),
      _.random(bounds.y + radius, bounds.y + bounds.height - radius)
    ),
    radius: radius,
    strokeWidth: 2,
    strokeColor: player
  });
}

// set up number of players and player colors
var players = [
  "rgb(237, 87 , 0  )", // orange
  "rgb(52 , 189, 238)", // blue
  "rgb(34 , 174, 58 )", // green
  // "rgb(255, 227, 0  )", // yellow
  "rgb(42 , 42 , 42 )", // gray
];

// start
_.each(players, function (color) {
  initial_turn(color);
});

// main
while (incomplete()) {
  player = players[n_iterations % players.length];
  turn(player);
}

// function onResize(event) {
//   polygon.position = view.center;
//   label.position = view.center;
// }
