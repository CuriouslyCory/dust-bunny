/** Read-only reference, built from the same catalogues and descriptions as the game. */
import { ABILITY_RULES, AMASS, DECOY, DISCHARGE, getAbility } from '../data/abilities';
import { CHARACTERS, type CharacterDef } from '../data/characters';
import { describeKeepsake, FELT_INPUT, keepsakeTypesFor, LOADOUT_SLOTS, RARITIES } from '../data/keepsakes';
import { CHARACTER_PERKS, PERKS, type PerkData } from '../data/perks';
import { PICKUPS, type PickupData } from '../data/pickups';
import { BASE_BUNNY_STATS } from '../entities/stats';
import { button } from './components';
import { abilityCard } from './keepsakeUi';
import { h } from './screens';

const note = (text: string): HTMLElement => h('p', { className: 'howto-note', textContent: text });

function card(name: string, icon: string, ...children: HTMLElement[]): HTMLElement {
  const symbol = h('span', { textContent: icon });
  symbol.setAttribute('aria-hidden', 'true');
  return h('article', { className: 'howto-card' }, h('h4', {}, symbol, ` ${name}`), ...children);
}

function group(title: string, ...children: HTMLElement[]): HTMLElement {
  return h('section', { className: 'howto-group' }, h('h3', { textContent: title }), ...children);
}

function characterCard(c: CharacterDef): HTMLElement {
  const s = { ...BASE_BUNNY_STATS, ...c.stats };
  const caps = c.caps;
  const ability = getAbility(c.ability);
  const extra = {
    decoy: `The cooldown starts when the Decoy ends. Touching it briefly stuns a Hazard (a clog); sprays and blasts pop it.`,
    amass: `While holding, move at ${AMASS.moveSpeedMul * 100}% speed, ignore knockback, and take ${AMASS.damageReduction * 100}% less damage. Vacuums pull ${AMASS.suctionMul}× as hard. Pull Debris and non-boss Hazards up to ${AMASS.pullRatio}× your radius; swallow non-boss Hazards up to ${AMASS.absorbRatio}× on contact. A charging boss crashes into you.`,
    discharge: `Use with a full Static meter. Roll above ${DISCHARGE.minSpeedFraction * 100}% speed to charge; Dash counts ${DISCHARGE.dashMultiplier}×. Below ${DISCHARGE.drainSpeedFraction * 100}% speed, lose ${DISCHARGE.drainPerSec * 100}% charge per second. Normal Hazards become scrap; bosses are stunned for ${DISCHARGE.bossStun} s, then cannot be Discharged for ${DISCHARGE.groundedFor} s (Grounded).`,
  }[c.ability];
  return card(
    c.name,
    ability.icon,
    note(c.description),
    note(`Strengths: ${c.strengths.join(' · ')}. Weaknesses: ${c.weaknesses.join(' · ')}.`),
    note(`Base stats (Casual, before Shop Upgrades): ${s.maxHealth} hearts · speed ×${s.speed} · acceleration ×${s.acceleration} · starting radius ${s.startRadius} cm · Dash cooldown ${s.dashCooldown} s · magnet reach ${s.magnetRadius} r · knockback resistance ${Math.round(s.knockbackResistance * 100)}% · suction ×${s.suctionMultiplier}.`),
    note(`Permanent stat limits: speed ×${caps.speed?.max} · ${caps.maxHealth?.max} hearts · Dash cooldown at least ${caps.dashCooldown?.min} s · magnet ${caps.magnetRadius?.max} r · knockback resistance ${Math.round((caps.knockbackResistance?.max ?? 0) * 100)}% · suction at least ×${caps.suctionMultiplier?.min}.`),
    abilityCard(c.ability, []),
    note(`Use ${ability.trigger === 'hold' ? 'hold' : 'tap'} E, right mouse button, or the touch Ability button. ${extra}`),
  );
}

function characters(): HTMLElement[] {
  return [
    note('Abilities are available from your first Run. r means your current Bunny radius. These are base values without Keepsakes; Upgrades, Perks and Difficulty can change your stats. Timed effects apply after permanent stat limits.'),
    ...CHARACTERS.map(characterCard),
    note(`An Ability can stun a boss at most once every ${ABILITY_RULES.bossStunInterval} s. Ram the stunned boss to land a hit. Lint’s base clog lasts ${DECOY.clogStun} s.`),
  ];
}

function powerUps(): HTMLElement[] {
  return [
    note('Power-ups are Pickups found on the floor: roll over one to collect it. Timed effects expire; collecting the same timed Pickup refreshes its timer. Hoarder extends timed effects. Bubble Wrap lasts until a hit uses it; Crumb Cake heals immediately.'),
    ...Object.values<PickupData>(PICKUPS).map((p) => card(p.name, p.icon, note(p.description))),
  ];
}

function perkCard(p: PerkData): HTMLElement {
  return card(p.name, p.icon, note(p.description), note(p.unique ? 'Once per Run.' : `Up to ${p.maxStacks ?? 1} stacks per Run.`));
}

function perks(): HTMLElement[] {
  return [
    note('Choose a Perk at each Tier-up. It lasts for the current Run. Shared Perks can appear for any Character; Character Perks appear only for that Bunny. Permanent stats still respect Character caps; drafts stop offering Perks whose stats are all at cap. r means your current radius. Slash-separated values show the effect at each stack.'),
    group('All Characters', ...Object.values<PerkData>(PERKS).map(perkCard)),
    ...CHARACTERS.map((c) => group(`${c.name} only`, ...Object.values<PerkData>(CHARACTER_PERKS).filter((p) => p.character === c.id).map(perkCard))),
  ];
}

function keepsakes(): HTMLElement[] {
  return [
    note(`Bosses drop Keepsakes for the Character that beat them. They persist between Runs in that Character’s Hoard. Tuck up to ${LOADOUT_SLOTS} into a Loadout before playing, or fill an empty slot from a boss drop during a Run. A Keepsake already tucked in stays for that Run. Two copies add their effects, subject to Ability limits.`),
    note(`Under the Couch, felt ${FELT_INPUT} of the same type and rarity into one of the next rarity for Fluff, up to one rarity above the peak of the best boss that Character has beaten. Later bosses favour higher rarities. Values below are for one copy; r means your current radius.`),
    ...CHARACTERS.map((c) => group(
      `${c.name} · ${getAbility(c.ability).name}`,
      ...keepsakeTypesFor(c.id).map((k) => card(
        k.name,
        k.icon,
        h('dl', { className: 'howto-rarities' }, ...RARITIES.flatMap((r) => [
          h('dt', { textContent: r.name }),
          h('dd', { textContent: describeKeepsake({ type: k.id, rarity: r.rarity }) }),
        ])),
      )),
    )),
  ];
}

/** Category buttons stay outside the scroller so a long reference never hides navigation. */
export function howToPlayGuide(body: HTMLElement): { navigation: HTMLElement; reset(): void } {
  const basics = [...body.children];
  const categories = [
    { label: 'Basics', render: () => basics },
    { label: 'Characters', render: characters },
    { label: 'Power-ups', render: powerUps },
    { label: 'Perks', render: perks },
    { label: 'Keepsakes', render: keepsakes },
  ];
  const navigation = h('nav', { className: 'howto-nav' });
  navigation.setAttribute('aria-label', 'How to play topics');
  body.id = 'howto-content';
  const select = (index: number): void => {
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === index)));
    body.classList.toggle('howto-reference', index !== 0);
    body.replaceChildren(...categories[index]!.render());
    body.scrollTop = 0;
    body.setAttribute('aria-label', categories[index]!.label);
  };
  const buttons = categories.map((c, i) => {
    const b = button(c.label, () => select(i), { size: 'sm' });
    b.setAttribute('aria-controls', body.id);
    return b;
  });
  navigation.append(...buttons);
  body.setAttribute('role', 'region');
  select(0);
  return { navigation, reset: () => select(0) };
}
