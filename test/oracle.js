/* Checks a finished game against the written rules, using only circle
positions, sizes, and colors. It deliberately shares no code with
js/game.js, and looks for three-way overlaps by brute force. */

var dist = function (a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
};

var fully_inside = function (small, big) {
  return dist(small, big) + small.r <= big.r;
};

var fully_outside = function (small, big) {
  return dist(small, big) >= small.r + big.r;
};

var discs_touch = function (a, b) {
  return dist(a, b) < a.r + b.r;
};

var find_violations = function (game) {
  var found = [];
  var report = function (message) {
    found.push(message);
  };
  var smalls = game.smalls;
  var bigs = game.bigs;
  var inside_of = function (big) {
    return smalls.filter(function (small) {
      return fully_inside(small, big);
    });
  };

  game.smalls.concat(game.bigs).forEach(function (c) {
    if (c.x - c.r < 0 || c.y - c.r < 0 || c.x + c.r > game.width ||
        c.y + c.r > game.height) {
      report('circle off the paper');
    }
  });

  smalls.forEach(function (small, i) {
    var diameter = 2 * small.r / game.scale;
    if (diameter < 1 || diameter > 2) {
      report('small diameter ' + diameter + 'cm');
    }
    smalls.slice(i + 1).forEach(function (other) {
      if (discs_touch(small, other)) {
        report('small circles touch');
      }
    });
    bigs.forEach(function (big) {
      if (!fully_inside(small, big) && !fully_outside(small, big)) {
        report('small circle straddles a big circle');
      }
    });
    var sets = bigs.filter(function (big) {
      return fully_inside(small, big);
    });
    if (sets.length > 2) {
      report('small circle in ' + sets.length + ' sets');
    }
    if (sets.length !== small.sets.length) {
      report('recorded membership differs from the drawing');
    }
  });

  bigs.forEach(function (big, i) {
    var diameter = 2 * big.r / game.scale;
    if (diameter < 5 || diameter > 10) {
      report('big diameter ' + diameter + 'cm');
    }
    var members = inside_of(big);
    if (members.length > 3) {
      report('set has ' + members.length + ' members');
    }
    if (members.length !== big.members.length) {
      report('recorded members differ from the drawing');
    }
    var colors = members.map(function (member) {
      return member.color;
    });
    if (new Set(colors).size !== colors.length) {
      report('set contains the same color twice');
    }
    if (colors.indexOf(big.color) !== -1) {
      report('set contains its own color');
    }
    bigs.slice(i + 1).forEach(function (other) {
      if (!discs_touch(big, other)) {
        return;
      }
      if (dist(big, other) <= Math.abs(big.r - other.r)) {
        report('one big circle inside another');
      }
      var shared = members.filter(function (member) {
        return fully_inside(member, other);
      });
      if (shared.length !== 1) {
        report('sets overlap around ' + shared.length + ' members');
      }
    });
  });

  // a set is complete when its three members are all in another set too
  bigs.forEach(function (big) {
    var members = inside_of(big);
    var complete = members.length === 3 && members.every(function (member) {
      return bigs.filter(function (other) {
        return fully_inside(member, other);
      }).length === 2;
    });
    if (complete !== (big.completed_by !== null)) {
      report('completed mark differs from the drawing');
    }
    if (complete) {
      var overlapping = bigs.filter(function (other) {
        return other !== big && discs_touch(big, other);
      });
      if (overlapping.length !== 3) {
        report('complete set intersects ' + overlapping.length + ' sets');
      }
    }
  });

  // walk a fine grid over every big circle counting covering circles
  bigs.forEach(function (big) {
    var near = bigs.filter(function (other) {
      return discs_touch(big, other);
    });
    for (var x = big.x - big.r; x <= big.x + big.r; x += 2) {
      for (var y = big.y - big.r; y <= big.y + big.r; y += 2) {
        var point = {x: x, y: y};
        var covering = near.filter(function (other) {
          return dist(point, other) <= other.r;
        });
        if (covering.length > 2) {
          report('three sets intersect at one location');
          return;
        }
      }
    }
  });

  return found;
};

module.exports = {find_violations: find_violations};
