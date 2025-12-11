// ==UserScript==
// @name        Roll20 7th Sea Dice Helper
// @namespace   https://petergeneric.github.io
// @version     1.2
// @description Roll20 7th Sea Dice Rolling Solver Integration Plugin
// @author      Peter Wright
// @match       https://app.roll20.net/editor
// @match       https://app.roll20.net/editor/
// @downloadURL https://petergeneric.github.io/7thsea-dice-solver/roll20.userscript.js
// @updateURL   https://petergeneric.github.io/7thsea-dice-solver/roll20.userscript.js
// @grant       none
// @inject-into page
// ==/UserScript==

(function () {
  'use strict';



  function init7thSeaRollingPlugin() {
    const SLEEP_TIME = 5000;
    const DESIRED_SHEET_NAME = '7thsea2e';
    const DEBUG = false;

    let attempts = 0;

    function initialise() {
      if (attempts++ > 60) {
        if(DEBUG) console.log('[7th Sea Plugin] Could not find system and #textchat in time, giving up');
        return;
      }

      const chatbox = document.getElementById('textchat');
      const charsheetname = window.PRIMARY_CHARSHEET_NAME || null;

      if (!charsheetname) {
        if(DEBUG) console.log('[7th Sea Plugin] PRIMARY_CHARSHEET_NAME not found, retrying...');
        setTimeout(initialise, SLEEP_TIME);
      }
      else if (!chatbox) {
        if(DEBUG) console.log('[7th Sea Plugin] #textchat not found, retrying shortly...');
        setTimeout(initialise, SLEEP_TIME);
      }
      else if (charsheetname !== DESIRED_SHEET_NAME) {
        if(DEBUG) console.log(`[7th Sea Plugin] Does not appear to be 7th Sea (got ${charsheetname}, want ${DESIRED_SHEET_NAME}). Plugin quitting.`);
      }
      else {
        if(DEBUG) console.log('[7th Sea Plugin] 7th Sea detected. Setting up chat monitoring...');

        function linkify(el) {
          function cleanText(text) {
            return text.replace(/[^0-9+,]/g, '').replace(/\+/g, ',');
          }

          if (el.style.cursor === 'help')
            return;
          else
            el.style.cursor = 'help';

          el.addEventListener('click', (e) => {
            e.preventDefault();
            window.open(`https://petergeneric.github.io/7thsea-dice-solver/?dice=${encodeURIComponent(cleanText(el.innerText))}`, '_blank').opener = null;
          });
        }

        document.querySelectorAll('.formula.formattedformula').forEach(linkify);

        new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
              if (node.nodeType === 1 && node.matches('.formula.formattedformula'))
                linkify(node);
              if (node.querySelectorAll)
                node.querySelectorAll('.formula.formattedformula').forEach(linkify);
            });
          });
        }).observe(chatbox, {
          childList: true,
          subtree: true
        });
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initialise);
    }
    else {
      initialise();
    }
  }

  // Inject script directly into page context
  const script = document.createElement('script');
  script.textContent = `
    ${init7thSeaRollingPlugin.toString()}
    init7thSeaRollingPlugin();
  `;

  // Required for Tampermonkey loading
  (document.head || document.documentElement).appendChild(script);
  script.remove();

  // Required for Violentmonkey page loading
  // N.B. this will also run for Tampermonkey and if DEBUG=true will produce confusing double logs
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init7thSeaRollingPlugin);
  }
  else {
    init7thSeaRollingPlugin();
  }
})();