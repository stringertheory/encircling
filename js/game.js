/* Rules engine for Encircling:

http://www.conditionaldesign.org/workshops/encircling/

Plain JavaScript with no Paper.js dependency, so it can run in the
browser (window.Encircling) and under Node (see test/). Drawing lives
in main.js.

A set is a big circle holding at most three small circles [members].
What is inside a circle is always worked out from the geometry, so the
recorded membership and the drawing cannot disagree.
*/
(function (root) {

  var MAX_MEMBERS = 3;
  var MAX_SETS_PER_SMALL = 2;
  var CLEARANCE = 2; // pixels kept between lines that must not touch
  var INITIAL_PADDING = 100; // pixels to avoid around border at the start
  var ATTEMPTS = 40; // random placements tried per circle
  var WIDE_ATTEMPTS = 1500; // and then per small circle, anywhere around it
  var FREE_ATTEMPTS = 200; // random placements tried for a free small circle
  var FREE_PADDING = 40; // pixels free small circles keep from the border
  var BONUS_MEMBERS = 2; // new members earned by completing a set
  var MIN_SEPARATION = 0.8; // of the larger radius, between crossing sets

  // what players value in a move, see score_move
  var WEIGHTS = {
    completion: 100,
    connection: 10,
    enclosed: 1,
    centered: 0.05
  };
  var PREFERRED_DIAMETER = [6.6, 7.8]; // centimeters, for packing sets tightly
  var START_SPREAD = 0.1; // of the paper, how far from its center play starts
  var MAX_TURNS = 80; // packing players stop here, leaving the outskirts bare
  var SITE_SPACING = 4.7; // centimeters between neighboring cells
  var SITES_TRIED = 3; // nearest cells considered around a small circle
  var SITE_ATTEMPTS = 3; // sizes and wobbles tried on each cell
  var SITE_WOBBLE = 1.5; // pixels off the grid, as if drawn by hand
  var MEMBER_DIAMETER = [1, 1.55]; // centimeters, members must fit in overlaps

  // small seeded generator, so a drawing can be reproduced from its seed
  var create_rng = function (seed) {
    var state = seed >>> 0;
    return function () {
      state = (state + 0x6D2B79F5) >>> 0;
      var t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  var between = function (game, low, high) {
    return low + game.rng() * (high - low);
  };

  var shuffled = function (game, items) {
    var copy = items.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(game.rng() * (i + 1));
      var swap = copy[i];
      copy[i] = copy[j];
      copy[j] = swap;
    }
    return copy;
  };

  var distance = function (a, b) {
    return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
  };

  // the rules give diameters in centimeters
  var small_radius = function (game) {
    return between(game, 1, 2) * game.scale / 2;
  };

  var big_radius = function (game) {
    return between(game, 5, 10) * game.scale / 2;
  };

  // Each set has three neighbors, so packed sets form a honeycomb. That
  // only fits if sets are of similar size with evenly spread members.
  var packs = function (game) {
    return game.strategy;
  };

  var preferred_radius = function (game) {
    return between(game, PREFERRED_DIAMETER[0], PREFERRED_DIAMETER[1]) *
      game.scale / 2;
  };

  var on_paper = function (game, circle) {
    return circle.x - circle.r >= CLEARANCE &&
      circle.y - circle.r >= CLEARANCE &&
      circle.x + circle.r <= game.width - CLEARANCE &&
      circle.y + circle.r <= game.height - CLEARANCE;
  };

  // 'inside', 'outside', or 'crossing' (touching the big circle's line)
  var small_relation = function (small, big) {
    var d = distance(small, big);
    if (d + small.r + CLEARANCE <= big.r) {
      return 'inside';
    }
    if (d - small.r - CLEARANCE >= big.r) {
      return 'outside';
    }
    return 'crossing';
  };

  // 'apart', 'nested', or 'crossing'
  var big_relation = function (a, b) {
    var d = distance(a, b);
    if (d >= a.r + b.r + CLEARANCE) {
      return 'apart';
    }
    if (d <= Math.abs(a.r - b.r) + CLEARANCE) {
      return 'nested';
    }
    return 'crossing';
  };

  var crossing_points = function (a, b) {
    var d = distance(a, b);
    var along = (d * d + a.r * a.r - b.r * b.r) / (2 * d);
    var height = Math.sqrt(Math.max(0, a.r * a.r - along * along));
    var ux = (b.x - a.x) / d;
    var uy = (b.y - a.y) / d;
    var mx = a.x + along * ux;
    var my = a.y + along * uy;
    return [
      {x: mx - height * uy, y: my + height * ux},
      {x: mx + height * uy, y: my - height * ux}
    ];
  };

  // Do three crossing circles share any area? If they do, that area has a
  // corner where two of the lines cross inside the third circle.
  var share_area = function (a, b, c) {
    var corner_inside = function (first, second, third) {
      return crossing_points(first, second).some(function (point) {
        return distance(point, third) <= third.r + CLEARANCE;
      });
    };
    return corner_inside(a, b, c) || corner_inside(a, c, b) ||
      corner_inside(b, c, a);
  };

  // Can this big circle be drawn? Returns the small circles it would
  // enclose, or null if it would break a rule.
  var check_big = function (game, big) {
    if (!on_paper(game, big)) {
      return null;
    }

    var enclosed = [];
    for (var i = 0; i < game.smalls.length; i++) {
      var relation = small_relation(game.smalls[i], big);
      if (relation === 'crossing') {
        return null;
      }
      if (relation === 'inside') {
        enclosed.push(game.smalls[i]);
      }
    }
    if (enclosed.length < 1 || enclosed.length > MAX_MEMBERS) {
      return null;
    }

    var colors = {};
    for (var j = 0; j < enclosed.length; j++) {
      var small = enclosed[j];
      if (small.color === big.color || colors[small.color] ||
          small.sets.length >= MAX_SETS_PER_SMALL) {
        return null;
      }
      colors[small.color] = true;
    }

    // sets may only overlap around one shared member
    var neighbors = [];
    for (var k = 0; k < game.bigs.length; k++) {
      var other = game.bigs[k];
      var between_them = big_relation(big, other);
      if (between_them === 'nested') {
        return null;
      }
      if (between_them === 'crossing') {
        // not a rule of the workshop: keeps sets from nearly coinciding
        if (distance(big, other) < MIN_SEPARATION * Math.max(big.r, other.r)) {
          return null;
        }
        var shared = enclosed.filter(function (member) {
          return member.sets.indexOf(other) !== -1;
        });
        if (shared.length !== 1) {
          return null;
        }
        neighbors.push(other);
      }
    }

    // at most two sets may intersect at one location
    for (var m = 0; m < neighbors.length; m++) {
      for (var n = m + 1; n < neighbors.length; n++) {
        if (big_relation(neighbors[m], neighbors[n]) === 'crossing' &&
            share_area(big, neighbors[m], neighbors[n])) {
          return null;
        }
      }
    }

    return enclosed;
  };

  // Can this small circle be drawn? Returns the big circles it would be
  // inside, or null if it would break a rule.
  var check_small = function (game, small) {
    if (!on_paper(game, small)) {
      return null;
    }
    for (var i = 0; i < game.smalls.length; i++) {
      var other = game.smalls[i];
      if (distance(small, other) < small.r + other.r + CLEARANCE) {
        return null;
      }
    }
    var containing = [];
    for (var j = 0; j < game.bigs.length; j++) {
      var relation = small_relation(small, game.bigs[j]);
      if (relation === 'crossing') {
        return null;
      }
      if (relation === 'inside') {
        containing.push(game.bigs[j]);
      }
    }
    return containing;
  };

  var can_join = function (big, color) {
    return big.members.length < MAX_MEMBERS && big.color !== color &&
      big.members.every(function (member) {
        return member.color !== color;
      });
  };

  var add_small = function (game, small, sets) {
    small.sets = [];
    game.smalls.push(small);
    sets.forEach(function (big) {
      small.sets.push(big);
      big.members.push(small);
    });
    return small;
  };

  var add_big = function (game, big, enclosed) {
    big.members = [];
    big.completed_by = null;
    game.bigs.push(big);
    enclosed.forEach(function (small) {
      small.sets.push(big);
      big.members.push(small);
    });
    return big;
  };

  // a small circle somewhere outside the sets
  var draw_free_small = function (game, color, x_padding, y_padding) {
    for (var i = 0; i < FREE_ATTEMPTS; i++) {
      var small = {
        x: between(game, x_padding, game.width - x_padding),
        y: between(game, y_padding, game.height - y_padding),
        r: small_radius(game),
        color: color
      };
      if (packs(game)) {
        // on an edge, where a free circle cannot block a cell
        var edges = edges_of(game, sites_near(game, small)[0]);
        var edge = edges[Math.floor(game.rng() * edges.length)];
        small.x = edge.x;
        small.y = edge.y;
        small.r = member_radius(game);
      }
      var containing = check_small(game, small);
      if (containing && containing.length === 0) {
        return add_small(game, small, []);
      }
    }
    return null;
  };

  // The big circle leans away from any set the small is already in, so
  // that the two sets overlap around the small. Wide proposals drop that
  // preference, to find the awkward spots that are still legal.
  var propose_big = function (game, small, color, wide) {
    var r = big_radius(game);
    var angle = between(game, 0, 2 * Math.PI);
    if (small.sets.length > 0 && !wide) {
      var set = small.sets[0];
      angle = Math.atan2(small.y - set.y, small.x - set.x) +
        between(game, -0.6, 0.6);
    }
    var offset = (wide ? game.rng() : between(game, 0.5, 0.9)) * (r - small.r);
    return {
      x: small.x + offset * Math.cos(angle),
      y: small.y + offset * Math.sin(angle),
      r: r,
      color: color
    };
  };

  // Would encircling these small circles complete sets?
  var count_completions = function (enclosed) {
    var completions = 0;
    var all_shared = enclosed.length === MAX_MEMBERS;
    enclosed.forEach(function (small) {
      if (small.sets.length === 0) {
        all_shared = false;
        return;
      }
      var set = small.sets[0];
      if (set.members.length === MAX_MEMBERS &&
          set.members.every(function (member) {
            return member === small ||
              member.sets.length === MAX_SETS_PER_SMALL;
          })) {
        completions += 1;
      }
    });
    return completions + (all_shared ? 1 : 0);
  };

  var is_completed = function (big) {
    return big.completed_by !== null;
  };

  // groups of completed sets connected to each other, largest first
  var completed_groups = function (game) {
    var seen = [];
    var groups = [];
    game.bigs.filter(is_completed).forEach(function (start) {
      if (seen.indexOf(start) !== -1) {
        return;
      }
      var group = [];
      var waiting = [start];
      seen.push(start);
      while (waiting.length > 0) {
        var big = waiting.pop();
        group.push(big);
        neighbors_of(big).filter(is_completed).forEach(function (neighbor) {
          if (seen.indexOf(neighbor) === -1) {
            seen.push(neighbor);
            waiting.push(neighbor);
          }
        });
      }
      groups.push(group);
    });
    return groups.sort(function (a, b) {
      return b.length - a.length;
    });
  };

  // The goal is to connect as many completed sets as possible, so moves
  // are worth more the closer they bring sets to a connected whole.
  var score_move = function (game, big, enclosed) {
    var center = {x: game.width / 2, y: game.height / 2};
    var score = WEIGHTS.enclosed * enclosed.length -
      WEIGHTS.centered * distance(big, center) / game.scale;
    enclosed.forEach(function (small) {
      if (small.sets.length === 0) {
        return;
      }
      score += WEIGHTS.connection;
    });
    return score + WEIGHTS.completion * count_completions(enclosed);
  };

  // the first legal big circle around a single small circle
  var find_single = function (game, color, targets, attempts, wide) {
    for (var i = 0; i < targets.length; i++) {
      for (var j = 0; j < attempts; j++) {
        var big = propose_big(game, targets[i], color, wide);
        var enclosed = check_big(game, big);
        if (enclosed && enclosed.length === 1 && enclosed[0] === targets[i]) {
          return {big: big, enclosed: enclosed};
        }
      }
    }
    return null;
  };

  // the best legal big circle found around any of the small circles
  var find_best = function (game, color, targets) {
    var best = null;
    var consider = function (big) {
      var enclosed = check_big(game, big);
      if (enclosed) {
        var score = score_move(game, big, enclosed);
        if (!best || score > best.score) {
          best = {big: big, enclosed: enclosed, score: score};
        }
      }
    };
    targets.forEach(function (small) {
      sites_around(game, small).forEach(function (site) {
        for (var j = 0; j < SITE_ATTEMPTS; j++) {
          consider(propose_site(game, site, color));
        }
      });
    });
    return best;
  };

  // Cells of the honeycomb come in two kinds, pointing opposite ways, so
  // a cell's three edges are 120 degrees apart.
  var edge_angles = function (game, site) {
    var first = game.grid.angle + (site.up ? Math.PI / 2 : -Math.PI / 2);
    return [0, 1, 2].map(function (i) {
      return first + i * 2 * Math.PI / 3;
    });
  };

  // the points midway between a cell and its neighbors, where members go
  var edges_of = function (game, site) {
    var half = game.grid.spacing / 2;
    return edge_angles(game, site).map(function (angle) {
      return {
        x: site.x + half * Math.cos(angle),
        y: site.y + half * Math.sin(angle)
      };
    });
  };

  // the cells nearest to a point, nearest first
  var sites_near = function (game, point) {
    var d = game.grid.spacing;
    var cos = Math.cos(game.grid.angle);
    var sin = Math.sin(game.grid.angle);
    var dx = point.x - game.width / 2;
    var dy = point.y - game.height / 2;
    var local_x = dx * cos + dy * sin;
    var local_y = dy * cos - dx * sin;
    var row = Math.round(local_y / (1.5 * d));
    var column = Math.round((local_x - row * Math.sqrt(3) * d / 2) /
                            (Math.sqrt(3) * d));
    var sites = [];
    for (var i = column - 2; i <= column + 2; i++) {
      for (var j = row - 2; j <= row + 2; j++) {
        [false, true].forEach(function (shifted) {
          var x = i * Math.sqrt(3) * d + j * Math.sqrt(3) * d / 2;
          var y = j * 1.5 * d + (shifted ? d : 0);
          sites.push({
            x: game.width / 2 + x * cos - y * sin,
            y: game.height / 2 + x * sin + y * cos,
            up: !shifted
          });
        });
      }
    }
    return sites.sort(function (a, b) {
      return distance(a, point) - distance(b, point);
    });
  };

  // the cells close enough to hold this small circle, which never change
  var sites_around = function (game, small) {
    if (!small.sites) {
      small.sites = sites_near(game, small).slice(0, SITES_TRIED);
    }
    return small.sites;
  };

  // a big circle on this cell of the honeycomb
  var propose_site = function (game, site, color) {
    return {
      x: site.x + between(game, -SITE_WOBBLE, SITE_WOBBLE),
      y: site.y + between(game, -SITE_WOBBLE, SITE_WOBBLE),
      r: preferred_radius(game),
      color: color,
      site: site
    };
  };

  var draw_big = function (game, color) {
    var targets = shuffled(game, game.smalls.filter(function (small) {
      return small.color !== color &&
        small.sets.length < MAX_SETS_PER_SMALL;
    }));
    var move = game.strategy ? find_best(game, color, targets) :
      find_single(game, color, targets, ATTEMPTS, false);
    if (!move && !packs(game)) {
      move = find_single(game, color, targets, WIDE_ATTEMPTS, true);
    }
    return move ? add_big(game, move.big, move.enclosed) : null;
  };

  var member_radius = function (game) {
    return between(game, MEMBER_DIAMETER[0], MEMBER_DIAMETER[1]) *
      game.scale / 2;
  };

  // a member on one of the set's edges, which check_small rejects if the
  // edge is taken
  var propose_edge_member = function (game, big, color) {
    var edges = edges_of(game, big.site);
    var edge = edges[Math.floor(game.rng() * edges.length)];
    return {
      x: edge.x + between(game, -SITE_WOBBLE, SITE_WOBBLE),
      y: edge.y + between(game, -SITE_WOBBLE, SITE_WOBBLE),
      r: member_radius(game),
      color: color
    };
  };

  // Members spread evenly around the set, near its line, where another
  // set can reach them.
  var propose_member = function (game, big, color) {
    if (packs(game)) {
      return propose_edge_member(game, big, color);
    }
    var r = small_radius(game);
    var angle = between(game, 0, 2 * Math.PI);
    if (big.members.length > 0) {
      var last = big.members[big.members.length - 1];
      angle = Math.atan2(last.y - big.y, last.x - big.x) + 2 * Math.PI / 3 +
        between(game, -0.5, 0.5);
    }
    var offset = between(game, 0.55, 0.9) * (big.r - r);
    return {
      x: big.x + offset * Math.cos(angle),
      y: big.y + offset * Math.sin(angle),
      r: r,
      color: color
    };
  };

  var draw_member = function (game, color) {
    var sets = shuffled(game, game.bigs.filter(function (big) {
      return can_join(big, color);
    }));
    if (game.strategy) {
      // fill the sets that are closest to being complete
      sets.sort(function (a, b) {
        return b.members.length - a.members.length;
      });
    }
    for (var i = 0; i < sets.length; i++) {
      for (var j = 0; j < ATTEMPTS; j++) {
        var small = propose_member(game, sets[i], color);
        var containing = check_small(game, small);
        if (containing && containing.length === 1 &&
            containing[0] === sets[i]) {
          return add_small(game, small, [sets[i]]);
        }
      }
    }
    return null;
  };

  var draw_members = function (game, color, count) {
    var members = [];
    for (var i = 0; i < count; i++) {
      var member = draw_member(game, color);
      if (member) {
        members.push(member);
      }
    }
    return members;
  };

  // A set is complete when all three members also belong to another set.
  var is_complete = function (big) {
    return big.members.length === MAX_MEMBERS &&
      big.members.every(function (member) {
        return member.sets.length === MAX_SETS_PER_SMALL;
      });
  };

  // the sets that overlap this one, one for each shared member
  var neighbors_of = function (big) {
    var neighbors = [];
    big.members.forEach(function (member) {
      member.sets.forEach(function (set) {
        if (set !== big) {
          neighbors.push(set);
        }
      });
    });
    return neighbors;
  };

  // Marks sets that have just become complete with the color that
  // completed them, which is also the color they get filled with.
  var mark_completed = function (game, color) {
    var completed = game.bigs.filter(function (big) {
      return big.completed_by === null && is_complete(big);
    });
    completed.forEach(function (big) {
      big.completed_by = color;
    });
    return completed;
  };

  // A turn with nothing to encircle is a pass. A member with nowhere
  // legal to go is skipped: the rules only allow free small circles at
  // the start and when a set is completed.
  var take_turn = function (game, color) {
    var big = draw_big(game, color);
    if (!big) {
      return null;
    }
    var turn = {
      color: color,
      big: big,
      enclosed: big.members.length,
      completed: [],
      bonus_members: [],
      bonus_free: []
    };
    turn.members = draw_members(game, color, turn.enclosed);

    // only encircling can complete a set, as new members are in one set
    turn.completed = mark_completed(game, color);
    turn.completed.forEach(function () {
      turn.bonus_members = turn.bonus_members.concat(
        draw_members(game, color, BONUS_MEMBERS)
      );
      var free = draw_free_small(game, color, FREE_PADDING, FREE_PADDING);
      if (free) {
        turn.bonus_free.push(free);
      }
    });
    return turn;
  };

  var create_game = function (options) {
    var game = {
      width: options.width,
      height: options.height,
      scale: options.scale,
      seed: options.seed,
      players: options.players || 4,
      strategy: options.strategy !== false, // false: players move at random
      rng: create_rng(options.seed),
      grid: {
        spacing: SITE_SPACING * options.scale,
        angle: 0
      },
      smalls: [],
      bigs: [],
      turns: []
    };
    game.grid.angle = between(game, 0, Math.PI / 3);
    game.initial = [];
    for (var color = 0; color < game.players; color++) {
      var x_padding = packs(game) ? game.width * (0.5 - START_SPREAD) :
        INITIAL_PADDING;
      var y_padding = packs(game) ? game.height * (0.5 - START_SPREAD) :
        INITIAL_PADDING;
      var start = draw_free_small(game, color, x_padding, y_padding);
      if (start) {
        game.initial.push(start);
      }
    }
    return game;
  };

  // The rules give no end, so play until nobody can move. Placement is
  // random, so "cannot move" means no legal move was found.
  var play = function (game) {
    var passes = 0;
    var color = 0;
    while (passes < game.players &&
           !(packs(game) && game.turns.length >= MAX_TURNS)) {
      var turn = take_turn(game, color);
      if (turn) {
        game.turns.push(turn);
        passes = 0;
      } else {
        passes += 1;
      }
      color = (color + 1) % game.players;
    }
    return game;
  };

  // Everything drawn, in the order it was drawn: circles, and fills for
  // the sets that were completed.
  var timeline = function (game) {
    var steps = [];
    var draw = function (circle) {
      steps.push({circle: circle});
    };
    game.initial.forEach(draw);
    game.turns.forEach(function (turn) {
      draw(turn.big);
      turn.members.forEach(draw);
      turn.completed.forEach(function (big) {
        steps.push({fill: big});
      });
      turn.bonus_members.forEach(draw);
      turn.bonus_free.forEach(draw);
    });
    return steps;
  };

  var api = {
    CLEARANCE: CLEARANCE,
    MAX_TURNS: MAX_TURNS,
    check_big: check_big,
    check_small: check_small,
    add_big: add_big,
    add_small: add_small,
    is_complete: is_complete,
    neighbors_of: neighbors_of,
    mark_completed: mark_completed,
    completed_groups: completed_groups,
    sites_near: sites_near,
    edges_of: edges_of,
    create_game: create_game,
    timeline: timeline,
    take_turn: take_turn,
    play: play
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Encircling = api;
  }

})(this);
