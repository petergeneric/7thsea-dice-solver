// 7th Sea Dice Solver
// Copyright 2025-2026 Peter Wright
// https://github.com/petergeneric/7thsea-dice-solver
// 
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// 
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
// 
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import {Model} from 'https://cdn.jsdelivr.net/npm/minizinc/dist/minizinc.mjs';

const SOLVE_BUDGET = 20000; // 20 seconds
const PERMIT_OPTIMISATIONS = true;

// MiniZinc model template - ported from Node.js version
function getMiniZincModel(dice, allowFifteens) {
  return `%
% Input
%

int: n_dice = ${dice.length};
array[1..n_dice] of 1..10: dice = [${dice.join(', ')}];
bool: allow_fifteens = ${allowFifteens};

% Upper bound on number of groups (best case is all tens)
int: max_groups = n_dice;

array[1..n_dice] of var 1..max_groups: group;  % which group each die belongs to
var 1..max_groups: n_groups;  % actual number of groups used

%
% Constraints
%

% Groups must be consecutive (1, 2, 3, ..., not 1, 3, 5, ...)
% Using indicator variables for better MIP performance
array[1..max_groups] of var 0..1: group_used;

constraint forall(g in 1..max_groups)(
  group_used[g] = bool2int(exists(d in 1..n_dice)(group[d] = g))
);

constraint forall(g in 1..max_groups)(
  group_used[g] <= bool2int(g <= n_groups)
);

constraint n_groups = sum(group_used);

% Calculate total for each group
array[1..max_groups] of var 0..100: group_sum;
constraint forall(g in 1..max_groups)(
  group_sum[g] = sum(d in 1..n_dice)(dice[d] * bool2int(group[d] = g))
);

% No group total can exceed 20
% TODO should really be allow_fifteens?20:18
% actually could further constrain it to sum of two max input rolls...
constraint forall(g in 1..max_groups)(
  group_sum[g] <= 20
);

% Scoring function with fifteens support
int: max_success_per_group = if allow_fifteens then 2 else 1 endif;
array[1..max_groups] of var 0..max_success_per_group: group_success;

constraint forall(g in 1..max_groups)(
  if allow_fifteens then
    % With fifteens: >= 15 worth 2, >= 10 worth 1
    group_success[g] <= bool2int(group_sum[g] >= 10) + bool2int(group_sum[g] >= 15)
  else
    % Standard: >= 10 worth 1
    group_success[g] <= bool2int(group_sum[g] >= 10)
  endif
);

constraint forall(g in 1..max_groups)(
  group_success[g] <= max_success_per_group * group_used[g]
);


% Bound successes so the solver knows if it can stop early
% In tens mode, we can get no more than total/10 successes
% In fifteens mode, we can get no more than total/15 + (remainder/10 >= 10 ? 1:0)
int: total_dice_value = sum(dice);
int: max_possible_successes = if allow_fifteens then
                                 ((total_dice_value div 15)*2) + 1
                               else
                                 total_dice_value div 10
                               endif;

var 0..max_possible_successes: successes;
constraint successes = sum(group_success);

% Objective: highest score
solve :: int_search(group, first_fail, indomain_min)
      maximize successes;

%
% Result
%

output [
  "Roll: ", show(dice), "\\n",
  "Groupings: ", show(group), "\\n",
  "Grouping scores: ", show([group_sum[g] | g in 1..fix(n_groups)]), "\\n",
  "Successes: ", show(successes), "\\n"
];`;
}

// Parse MiniZinc output
function parseMiniZincOutput(output) {
  const lines = output.trim().split('\n');
  const result = {};

  for (const line of lines) {
    if (line.startsWith('Groupings:')) {
      const match = line.match(/Groupings: \[(.*?)\]/);
      if (match) {
        result.groupings = match[1].split(',').map(n => parseInt(n.trim()));
      }
    }
    else if (line.startsWith('Grouping scores:')) {
      const match = line.match(/Grouping scores: \[(.*?)\]/);
      if (match) {
        result.grouping_scores = match[1].split(',').map(n => parseInt(n.trim()));
      }
    }
    else if (line.startsWith('Successes:')) {
      const match = line.match(/Successes: (\d+)/);
      if (match) {
        result.successes = parseInt(match[1]);
      }
    }
  }

  return result;
}

// Core MiniZinc solver using WASM
async function minizinc(dice, allowFifteens) {
  return new Promise((resolve, reject) => {
    try {
      const model = new Model();
      const modelContent = getMiniZincModel(dice, allowFifteens);

      model.addFile('solver.mzn', modelContent);

      const solve = model.solve({
        options: {
          solver: 'coinbc',
          'time-limit': SOLVE_BUDGET
        }
      });

      console.log(solve);

      let lastSolution = null;

      solve.on('solution', solution => {
        // WASM minizinc returns solutions as they're found
        // We want the last (best) one since we're maximizing
        if (solution.output && solution.output.default) {
          lastSolution = solution.output.default;
        }
      });

      solve.then(result => {
        if (lastSolution) {
          const parsed = parseMiniZincOutput(lastSolution);
          resolve(parsed);
        }
        else {
          reject(new Error('No solution found'));
        }
      });
    }
    catch (error) {
      reject(error);
    }
  });
}

// Solve exactly (without optimisations)
async function solveExactly(dice, allowFifteens) {
  if (dice.length === 0) {
    return {
      timeout: false,
      solveTime: 0,
      score: 0,
      groups: [],
    };
  }

  const startTime = Date.now();
  const result = await minizinc(dice, allowFifteens);
  const solveTimeMillis = Date.now() - startTime;

  // Group dice by their group number
  const groups = {};
  dice.forEach((die, index) => {
    const groupNum = result.groupings[index];
    if (!groups[groupNum]) {
      groups[groupNum] = [];
    }
    groups[groupNum].push(die);
  });

  return {
    timeout: solveTimeMillis >= SOLVE_BUDGET,
    solveTime: solveTimeMillis,
    score: result.successes,
    groups: Object.values(groups),
  };
}

// Main solve function with optimisations
async function solve(dice, allowFifteens) {
  // Try to remove number of dice going to solver
  // We do this by removing [10] or [9,1] rolls for base "tens only" case
  if (PERMIT_OPTIMISATIONS) {
    if (!allowFifteens && (dice.includes(10) || (dice.includes(9) && dice.includes(1)))) {
      let removed = [];

      // Create a copy so we don't mutate the original
      dice = [...dice];

      while (dice.includes(10) || (dice.includes(9) && dice.includes(1))) {
        if (dice.includes(10)) {
          dice.splice(dice.indexOf(10), 1);
          removed.push([10]);
        }

        if (dice.includes(9) && dice.includes(1)) {
          dice.splice(dice.indexOf(9), 1);
          dice.splice(dice.indexOf(1), 1);
          removed.push([9, 1]);
        }
      }

      if (removed.length !== 0) {
        const result = await solveExactly(dice, allowFifteens);

        // Now add back in the groups we've removed
        result.score += removed.length;
        for (const group of removed) {
          result.groups.push(group);
        }

        result.optimisations = {reserved: removed};

        return result;
      }
    }
  }

  // No optimisation, solve as-is
  return await solveExactly(dice, allowFifteens);
}


function showError(message) {
  const resultsDiv = document.getElementById('results');
  resultsDiv.innerHTML = `
            <div class="result-section error show">
                <div class="result-title">Error</div>
                <p>${message}</p>
            </div>
    `;

  resultsDiv.classList.add('show');
}

function showResults(dice, allowFifteens, result) {
  const resultsDiv = document.getElementById('results');
  const announcement = document.getElementById('results-announcement');

  // Announce success count to screen readers
  const successText = result.score === 1 ? '1 success' : `${result.score} successes`;
  if (announcement) {
    announcement.textContent = successText;
  }

  let html = '';

  // Show timeout warning if applicable
  if (result.timeout) {
    html += `
            <div class="timeout-warning">
                <strong>Warning:</strong> Solver reached time limit. Solution may not be optimal.
            </div>
        `;
  }

  html += `
        <div class="result-section show">
            <div class="result-title">${allowFifteens ? 'Tens or Fifteens' : 'Tens'} Mode</div>
            <div class="score">Score: ${result.score} ${result.score === 1 ? 'success' : 'successes'}</div>
            <div class="solve-time">Solved in ${result.solveTime}ms</div>
            <div class="groups">
                ${result.groups.map(group => {
    const sum = group.reduce((a, b) => a + b, 0);
    return `<div class="group ${sum >= 15 && allowFifteens ? 'success-2' : ''} ${sum >= 10 && (sum < 15 || !allowFifteens) ? 'success-1' : ''}">[${group.join(', ')}] = ${sum}</div>`;
  }).join('')}
            </div>
        </div>
    `;

  resultsDiv.innerHTML = html;
  resultsDiv.classList.add('show');

  // If optimisations were performed, let advanced users see what they were (mostly for troubleshooting...)
  if (result.optimisations && result.optimisations.reserved.length > 0) {
    try {
      resultsDiv.querySelector('.score').title = `Pre-solved guaranteed successes: ${result.optimisations.reserved.map(g => '[' + g.join(',') + ']').join(', ')}`;
    }
    catch(e) {
      // ignore
    }
  }
}

// Main solve function called from HTML
window.solveDice = async function (allowFifteens = false, solveBtn) {

  // Hide existing results
  const resultsDiv = document.getElementById('results');
  resultsDiv.classList.remove('show');

  // Clear screen reader announcement for fresh announcement on new result
  const announcement = document.getElementById('results-announcement');
  if (announcement) {
    announcement.textContent = '';
  }


  const diceInput = document.getElementById('diceInput').value;

  // Validate input
  if (!diceInput.trim()) {
    showError('Please enter dice values');
    return;
  }

  const loading = document.getElementById('loading');
  try {
    // Parse and validate dice first
    const dice = diceInput.replace(/[^0-9+,]/g, '').replace(/\++/g, ',').replace(/,+$/, '').split(',').map(d => {
      const num = parseInt(d.trim());
      if (isNaN(num) || num < 1 || num > 10) {
        throw new Error(`Invalid die value: ${d}. Must be between 1 and 10.`);
      }
      return num;
    });

    // Show loading and start dice animation
    loading.classList.add('show');
    if (window.showDiceAnimation) {
      window.showDiceAnimation(dice);
    }

    if (dice.length === 0) {
      showError('No dice provided');
    }
    else {

      // Disable button and show loading
      solveBtn.disabled = true;

      // Solve
      const result = await solve(dice, allowFifteens);

      // Show results
      showResults(dice, allowFifteens, result);
    }
  }
  catch (error) {
    console.error('Error solving:', error);
    showError(error.message || 'An error occurred while solving');
  }
  finally {
    // Stop dice animation and hide loading
    if (window.hideDiceAnimation) {
      window.hideDiceAnimation();
    }
    loading.classList.remove('show');
    solveBtn.disabled = false;
  }
};
