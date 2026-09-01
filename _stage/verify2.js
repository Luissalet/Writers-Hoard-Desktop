const sleep = (ms) => new Promise(r => setTimeout(r, ms));
location.hash = '#/project/proj_mthy3jeu_q7kvd1/overview';
await sleep(1600);
const card = [...document.querySelectorAll('button')].find(b => /elementos por revisar/i.test(b.innerText || ''));
if (!card) return { step: 'review card is not a button' };
const label = (card.innerText || '').replace(/\n+/g, ' | ');
card.click();
await sleep(1600);
const t = document.body.innerText || '';
const analyse = [...document.querySelectorAll('button')].find(b => /analizar/i.test(b.innerText || ''));
if (analyse) { analyse.click(); await sleep(4000); }
const t2 = document.body.innerText || '';
return {
  cardLabel: label,
  landedOnProofreader: /lector de pruebas/i.test(t),
  hash: location.hash,
  seedWording: (t2.match(/«[^»]+» se plantó[^.]*\./) || ['(none)'])[0],
};
