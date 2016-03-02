/* Trying to reproduce something like:

http://www.conditionaldesign.org/workshops/encircling/

*/
var scale = 7; // pixels per centimeter
var initial_padding = 100; // pixels to avoid around border
var stroke_width = 1;

var get_radius = function(path) {
  return path.bounds.width / 2 + path.style.strokeWidth / 2;
}

var small_radius = function () {
  return _.random(1 * scale, 2 * scale);
}

var big_radius = function () {
  return _.random(5 * scale, 10 * scale);
}

var smalls = [];
var bigs = [];

var n_iterations = 0;
var max_iterations = 10;
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
  var small = new Path.Circle({
    center: new Point(
      _.random(
	bounds.x + initial_padding,
	bounds.x + bounds.width - initial_padding
      ),
      _.random(
	bounds.y + initial_padding,
	bounds.y + bounds.height - initial_padding
      )
    ),
    radius: radius,
    strokeWidth: stroke_width,
    strokeColor: player
  });
  small.data.encircled_by = [];
  smalls.push(small);
}

var can_encircle = function (small, player) {
  if (small.data.encircled_by.length > 1 || small.style.strokeColor.equals(player)) {
    return false;
  } else {
    return true;
  }
}

var encircle = function (small, player) {
  console.log("encircle", n_iterations, small.style.strokeColor.toCSS());
  var radius = big_radius();
  var max_translate = 0.9 * (radius - get_radius(small));
  var min_translate = max_translate * 0.8;
  var translate = Math.random() * (max_translate - min_translate) + min_translate;
  var angle = Math.random() * 2 * Math.PI;
  if (small.data.encircled_by.length > 0) {
    angle = small.data.encircled_by[0].angle + Math.PI;
  }
  var center = new Point(
    small.position.x + translate * Math.cos(angle),
    small.position.y + translate * Math.sin(angle)
  )
  var big = new Path.Circle({
    center: center,
    radius: radius,
    strokeWidth: stroke_width,
    strokeColor: player,
  });
  small.data.encircled_by.push({
    circle: big,
    angle: angle
  });
  big.data.encircled = [{
    circle: small,
    angle: angle + Math.PI
  }];
  bigs.push(big);
  return big;
}

var draw_big_circle = function (player) {
  var big = null;
  _.every(smalls, function (small) {
    if (can_encircle(small, player)) {
      big = encircle(small, player);
      return false;
    } else {
      return true;
    }
  });
  return big;
}

var can_enter = function (big, player) {
  // Can enter if there is less than 3 smalls in this big, and if
  // none of the existing smalls have the same color as player
  if (big.data.encircled.length < 3 && !(big.style.strokeColor.equals(player))) {
    var all_different = _.every(big.data.encircled, function (small) {
      return !(small.circle.style.strokeColor.equals(player));
    });
    if (all_different) {
      return true;
    } else {
      return false;
    };
  } else {
    return false;
  }
};

var enter = function (big, player) {
  console.log("enter", n_iterations, big.style.strokeColor.toCSS());
  var radius = small_radius();
  var max_translate = 0.9 * (get_radius(big) - radius);
  var min_translate = max_translate * 0.8;
  var translate = Math.random() * (max_translate - min_translate) + min_translate;
  var angle = Math.random() * 2 * Math.PI;
  var bde = big.data.encircled;
  if (bde.length > 0) {
    angle = bde[bde.length - 1].angle + 2 * Math.PI / 3;
  };
  var center = new Point(
    big.position.x + translate * Math.cos(angle),
    big.position.y + translate * Math.sin(angle)
  )
  var small = new Path.Circle({
    center: center,
    radius: radius,
    strokeWidth: stroke_width,
    strokeColor: player,
  });
  small.data.encircled_by = [{
    circle: big,
    angle: angle
  }];
  big.data.encircled.push({
    circle: small,
    angle: angle
  });
  smalls.push(small);
  return small;
  
};

var draw_new_member = function (player) {
  var small = null;
  _.every(bigs, function (big) {
    if (can_enter(big, player)) {
      small = enter(big, player);
      return false;
    } else {
      return true;
    }
  });
  if (!(small)) {
    console.log('booyah')
    small = initial_turn(player);
  }
  return small;
  
};


var turn = function (player) {

  // shuffle the smalls
  smalls = _.shuffle(smalls);
  
  // first, draw a big circle and try to encircle small circles with
  // it
  var big = draw_big_circle(player);

  bigs = _.shuffle(bigs);
  console.log(bigs);
  
  // Then, draw as many new members as you have encircled (NOTE: it
  // appears that they only draw one...)
  var small = draw_new_member(player);

  // If you complete a set draw three new small circles: two members
  // and one outside the sets.
}

// set up number of players and player colors
var players = [
  new Color(237 / 255,  87 / 255,   0 / 255), // orange
  new Color( 52 / 255, 189 / 255, 238 / 255), // blue
  new Color( 34 / 255, 174 / 255,  58 / 255), // green
  // new Color(255 / 255, 227 / 255,   0 / 255), // yellow
  new Color( 42 / 255,  42 / 255,  42 / 255), // gray
];

// start
_.each(players, function (color) {
  initial_turn(color);
});

// main
while (incomplete()) {
  player = players[n_iterations % players.length];
  console.log('ROUND:', n_iterations, player.toCSS());
  turn(player);
}

// function onResize(event) {
//   polygon.position = view.center;
//   label.position = view.center;
// }
