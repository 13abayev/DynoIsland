'use strict';
// Robo, the mascot: a small face at the left of the island that shows how things are.
//   idle   blinks now and then        busy   looks around while your agents work
//   alert  wide eyes when one needs you      happy  smiles when one is done
//   music  bobs along to what plays          sleep  dozes while you are away

const ROBO = `<svg viewBox="0 0 24 24" class="robo-face">
  <rect class="robo-head" x="3" y="5" width="18" height="15" rx="6"/>
  <path class="robo-antenna" d="M12 5V2.6"/><circle class="robo-tip" cx="12" cy="2.2" r="1.3"/>
  <g class="robo-eyes"><ellipse cx="9" cy="12.2" rx="1.6" ry="2"/><ellipse cx="15" cy="12.2" rx="1.6" ry="2"/></g>
  <g class="robo-happy"><path d="M7.4 12.8q1.6-2.2 3.2 0M13.4 12.8q1.6-2.2 3.2 0"/></g>
  <g class="robo-closed"><path d="M7.5 12.6h3M13.5 12.6h3"/></g>
  <path class="robo-mouth" d="M10 16.4q2 1.3 4 0"/>
</svg>`;

ui.lead = (mood, fallback) => (state.settings?.mascot === false ? fallback : `<span class="robo ${mood}">${ROBO}${mood === 'sleep' ? '<i class="zz">z</i>' : ''}</span>`);

ui.settings.push({ tab: 'general', order: 30, render: () => settingSection('Look',
  settingCheck('mascot', 'Robo the mascot', 'A small face at the left of the island that blinks, looks around while agents work, smiles when one is done and dozes while you are away')) });
