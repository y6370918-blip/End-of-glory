"use strict";

// The development server hot-reloads rules.js without necessarily evicting its
// generated-data dependency. Always pair a freshly loaded rules module with the
// current data schema instead of validating a stale cached data.js object.
const dataPath = require.resolve("./data.js");
delete require.cache[dataPath];
const data = require(dataPath);
const ActionProtocol = require("./action-protocol.js");
const ConnectionData = require("./connection-data.js");
const ViewExplanations = require("./modules/analysis/view-explanations.js");
const { createAnalysis } = require("./modules/analysis/index.js");
const {
  AP,
  AP_ROLE,
  CP,
  CP_ROLE,
  HISTORICAL,
  MO_NATIONS,
  NONE,
} = require("./modules/core/constants.js");
const { findUnit } = require("./modules/core/game-utils.js");
const {
  canonicalizeEventState,
  enterEventFlow,
} = require("./modules/core/event-flow.js");
const {
  compactHistoryState,
  decodeRollbackStates,
  encodeRollbackStates,
  rollbackSnapshot,
  setRollbackSnapshots,
} = require("./modules/core/history.js");
const {
  clone,
  factionRole,
  other,
  roleFaction,
  unique,
} = require("./modules/core/utils.js");
const { createCombatSystem } = require("./modules/systems/combat.js");
const { createCombatCardSystem } = require("./modules/systems/combat-cards.js");
const { createEventSystem } = require("./modules/systems/events.js");
const { createFrontSystem } = require("./modules/systems/fronts.js");
const { createMapSystem } = require("./modules/systems/map.js");
const { createMoSystem } = require("./modules/systems/mo.js");
const { createNavalSystem } = require("./modules/systems/naval.js");
const { createReplacementSystem } = require("./modules/systems/replacement.js");
const { createSupplySystem } = require("./modules/systems/supply.js");
const { createUnitSystem } = require("./modules/systems/units.js");
const { createTurnSystem } = require("./modules/systems/turn.js");
const { createActionSystem } = require("./modules/systems/action.js");
const { createCardZoneSystem } = require("./modules/systems/card-zones.js");
const {
  createDeterministicSystem,
} = require("./modules/systems/deterministic.js");
const { createViewSystem } = require("./modules/view.js");
const { createOperationsSystem } = require("./modules/systems/operations.js");
const { createEngine } = require("./modules/engine.js");
const {
  createActivationStates,
} = require("./modules/states/states_activation.js");
const { createMovementStates } = require("./modules/states/states_movement.js");
const { createCombatStates } = require("./modules/states/states_combat.js");
const { createActionStates } = require("./modules/states/states_action.js");
const { createTurnStates } = require("./modules/states/states_turn.js");
const { createEventStates } = require("./modules/states/states_event.js");

exports.roles = [AP_ROLE, CP_ROLE];
exports.scenarios = [HISTORICAL];
exports.default_scenario = HISTORICAL;

const spaceById = Object.fromEntries(
  data.spaces.map((space) => [space.id, space]),
);
const pieceById = Object.fromEntries(
  data.pieces.map((piece) => [piece.id, piece]),
);
const cardById = Object.fromEntries(data.cards.map((card) => [card.id, card]));
const cardSpecById = data.card_effects || {};
const moById = Object.fromEntries(
  Object.values(data.mo)
    .flat()
    .map((mo) => [mo.id, mo]),
);
const CardZones = createCardZoneSystem({ data, AP, CP, cardById });
const AUTO_CARD_CONSERVATION = !process.env.NODE_TEST_CONTEXT;
let undoActionContext = null;
function ensureState(state) {
  if (!state) return state;
  const previousVersion = Number(state.version) || 0;
  if (!state.opening) state.opening = {};
  if (!state.action_state) {
    state.action_state = {
      turn: state.turn,
      round: state.action_round,
      actor: state.active,
      used_combat_cards: [],
    };
  }
  if (!Array.isArray(state.action_state.used_combat_cards))
    state.action_state.used_combat_cards = [];
  if (!state.card_owners) state.card_owners = {};

  state.vp = clampVp(state.vp ?? 10);
  if (!state.pending_event) state.pending_event = null;
  if (state.pending_event?.card) {
    const pendingCardId = Number(state.pending_event.card);
    const pendingCard = cardById[pendingCardId];
    if (pendingCard)
      state.pending_event.owner =
        state.card_owners[pendingCardId] || pendingCard.faction;
  }
  if (!state.turn_flags) state.turn_flags = {};
  if (!state.usage_limits) state.usage_limits = {};
  if (!state.front_storage) state.front_storage = { russian: 0, turkish: 0 };
  if (!state.entry_tracks) state.entry_tracks = { us: 0, armistice: 0 };
  if (!state.campaign_flags) state.campaign_flags = { paris_attacked: false };
  if (!state.combat_modifiers) state.combat_modifiers = {};
  if (state.combat) {
    state.combat.attackers ||= [];
    state.combat.defenders ||= [];
    state.combat.origins ||= {};
  }
  if (!state.pending_replacement) state.pending_replacement = null;
  if (
    state.combat?.modifiers &&
    !Array.isArray(state.combat.modifiers.modifier_sources)
  )
    state.combat.modifiers.modifier_sources = [];
  if (!state.hq_turn_track) state.hq_turn_track = { ap: [], cp: [] };
  if (!state.post_combat_window) state.post_combat_window = null;
  if (!state.retained_combat_cards)
    state.retained_combat_cards = { ap: [], cp: [] };
  if (!state.pending_combat_card_disposition)
    state.pending_combat_card_disposition = null;
  if (!state.draw_discard) state.draw_discard = null;
  if (!state.voluntary_cleanup) state.voluntary_cleanup = null;
  if (!state.event_history) state.event_history = [];
  if (!state.permanently_removed_units) state.permanently_removed_units = [];
  if (!state.eliminated) state.eliminated = { ap: [], cp: [] };
  if (!state.mo.pool) state.mo.pool = {};
  if (!state.mo.draw_bonus) state.mo.draw_bonus = {};
  if (!state.mo.draw_count) state.mo.draw_count = {};
  if (!state.mo.draw_limit) state.mo.draw_limit = {};
  if (!state.mo.completion_required) state.mo.completion_required = {};
  if (!state.mo.progress) state.mo.progress = {};
  if (!state.mo.drm_used) state.mo.drm_used = {};
  if (!state.mo.targets) state.mo.targets = {};
  if (!state.mo.bag) state.mo.bag = {};
  if (!state.mo.drawn) state.mo.drawn = {};
  if (!state.mo.review) state.mo.review = { confirmed: [] };
  if (!Array.isArray(state.mo.review.confirmed)) state.mo.review.confirmed = [];
  if (!Array.isArray(state.mo.revealed)) state.mo.revealed = [];
  if (!Array.isArray(state.mo.history)) state.mo.history = [];
  if (!state.mo.waived) state.mo.waived = {};
  if (!state.mo.penalized) state.mo.penalized = {};
  if (!state.mo.front_commitments) state.mo.front_commitments = {};
  if (!state.scheduled_events) state.scheduled_events = [];
  if (!state.markers) state.markers = {};
  if (
    state.markers.killing_ground &&
    state.markers.killing_ground.destroy_vp == null
  ) {
    const card = cardById[state.markers.killing_ground.source_card || 720];
    state.markers.killing_ground.destroy_vp =
      ruleModifier(card)?.destroy_vp || 1;
  }
  if (!state.fortifications) state.fortifications = {};
  for (const [space, value] of Object.entries(state.fortifications))
    state.fortifications[space] = Math.max(0, Number(value) || (value ? 1 : 0));
  if (!state.naval) {
    state.naval = {
      track: 0,
      selections: {},
      points: { ap: 0, cp: 0 },
    };
  }
  if (!state.naval.event_queue) state.naval.event_queue = [];
  if (state.naval.resolving == null) state.naval.resolving = false;
  if (!state.naval.pending_fleet_cards) state.naval.pending_fleet_cards = {};
  if (!state.naval.dispositions) state.naval.dispositions = {};
  if (!state.naval.disposition_order) state.naval.disposition_order = [];
  if (previousVersion < 18) {
    if (state.state === "naval_choice") {
      for (const selection of Object.values(state.naval.selections || {}))
        if (selection && typeof selection === "object")
          delete selection.disposition;
    }
    if (state.naval.resolving) {
      state.naval.pending_fleet_cards = {};
      state.naval.dispositions = {};
      state.naval.disposition_order = [];
      state.naval.legacy_disposition_complete = true;
    }
  }
  if (state.sr && !state.sr.used_units) state.sr.used_units = [];
  if (state.sr && state.sr.selected_unit === undefined)
    state.sr.selected_unit = null;
  if (state.pending_retreat) {
    if (
      !state.pending_retreat.target &&
      typeof state.pending_retreat.from === "string"
    )
      state.pending_retreat.target = state.pending_retreat.from;
    if (state.combat && !state.combat.target && state.pending_retreat.target)
      state.combat.target = state.pending_retreat.target;
    state.pending_retreat.units ||= [];
    state.pending_retreat.remaining ||= Object.fromEntries(
      state.pending_retreat.units.map((id) => [
        id,
        state.pending_retreat.steps ?? null,
      ]),
    );
    state.pending_retreat.paths ||= Object.fromEntries(
      state.pending_retreat.units.map((id) => [
        id,
        [state.pending_retreat.from].filter(Boolean),
      ]),
    );
    state.pending_retreat.advanced_ids ||= [];
    state.pending_retreat.selected_advance_units ||= [];
    if (!Array.isArray(state.pending_retreat.selected_units))
      state.pending_retreat.selected_units = state.pending_retreat.selected_unit
        ? [state.pending_retreat.selected_unit]
        : [];
    delete state.pending_retreat.selected_unit;
    delete state.pending_retreat.selected_distance;
  }
  // Saves made while an orphaned defending HQ interrupted a vacant-space
  // advance used to carry a null resume target.  Preserve the pending advance
  // instead of returning to the ordinary operations state after relocation.
  if (
    state.pending_event?.kind === "hq_relocation" &&
    state.pending_event.resume == null &&
    state.pending_retreat &&
    (state.pending_retreat.advance_mode === "vacant" ||
      state.pending_retreat.phase === "advance")
  )
    state.pending_event.resume = "post_retreat_advance";
  if (state.ops && !state.ops.entrench_attempted)
    state.ops.entrench_attempted = [];
  if (state.ops && state.ops.pending_siege === undefined)
    state.ops.pending_siege = null;
  if (state.ops && !state.ops.activated_units) state.ops.activated_units = {};
  if (state.ops && !state.ops.region_activations)
    state.ops.region_activations = { move: {}, attack: {}, construct: {} };
  if (state.ops && state.ops.pending_activation === undefined)
    state.ops.pending_activation = null;
  if (state.ops && state.ops.preactivation_sr_selected === undefined)
    state.ops.preactivation_sr_selected = null;
  if (state.ops && state.ops.pending_attack === undefined)
    state.ops.pending_attack = null;
  if (state.ops?.pending_attack) {
    state.ops.pending_attack.mo_assignments ||= {};
    state.ops.pending_attack.mo_decisions ||= {};
    state.ops.pending_attack.mo_marker_origins = computeMoMarkerOrigins(
      state,
      state.ops.pending_attack,
    );
  }
  if (state.combat_window) {
    state.combat_window.defense_mo_assignments ||= {};
    state.combat_window.defense_mo_decisions ||= {};
  }
  if (state.ops && state.ops.movement === undefined) state.ops.movement = null;
  if (state.ops && state.ops.move_selection === undefined)
    state.ops.move_selection = null;
  if (state.state === "movement" && state.ops?.moving && !state.ops.movement) {
    const unit = state.units.find(
      (candidate) => candidate.id === state.ops.moving,
    );
    if (unit) {
      const routes = movementRoutes(state, unit, [unit.id]);
      state.ops.movement = {
        unit: unit.id,
        units: [unit.id],
        active_units: [unit.id],
        stopped_units: [],
        origin: unit.location,
        path: [],
        routes_by_unit: { [unit.id]: routes },
        endpoints_by_unit: {
          [unit.id]: [...new Set(routes.map((route) => route.at(-1)))],
        },
        activation_kind:
          regionActivationBatchForUnit(state, unit.id, ["move"])?.kind ||
          state.activations?.[unit.location],
        began_in_fort_limited_supply: {
          [unit.id]: Boolean(unit.fort_limited_supply),
        },
        spent_by_unit: { [unit.id]: 0 },
      };
    }
  }
  if (state.ops?.movement && !Array.isArray(state.ops.movement.units)) {
    const unit = state.ops.movement.unit || state.ops.moving;
    state.ops.movement.units = unit ? [unit] : [];
    state.ops.movement.active_units = unit ? [unit] : [];
    state.ops.movement.stopped_units = [];
    state.ops.movement.spent_by_unit = Object.fromEntries(
      unit ? [[unit, state.ops.movement.path?.length || 0]] : [],
    );
  }
  if (state.ops?.movement) {
    state.ops.movement.began_in_fort_limited_supply ||= {};
    state.ops.movement.began_in_limited_supply ||= {};
    state.ops.movement.began_adjacent_enemy ||= {};
  }
  if (!state.entry_reserve) state.entry_reserve = { it: [] };
  if (
    previousVersion < 4 &&
    !state.events?.entry_it &&
    !state.entry_reserve.it.length
  ) {
    const italianUnits = state.units.filter((unit) => unit.nation === "it");
    state.units = state.units.filter((unit) => unit.nation !== "it");
    state.entry_reserve.it.push(...italianUnits);
  }
  if (state.supply_warnings === undefined) state.supply_warnings = null;
  if (state.supply_warning_editor === undefined)
    state.supply_warning_editor = null;
  if (state.pending_supply_warning_review === undefined)
    state.pending_supply_warning_review = null;
  if (state.rollback_proposal === undefined) state.rollback_proposal = null;
  if (state.rollback_confirmation === undefined)
    state.rollback_confirmation = null;
  if (!Array.isArray(state.action_history)) state.action_history = [];
  if (state.pending_event?.kind === "august_reposition") {
    state.pending_event.units ||= [];
    state.pending_event.selected_units ||= [];
  }
  if (previousVersion < 10 && state.state === "mo_review") {
    state.mo.review.confirmed = [];
    state.active = CP;
  }
  if (previousVersion < 13) {
    for (const [nation, current] of Object.entries(state.mo.current || {})) {
      const locked = (current || []).filter((id) => {
        const definition = moDefinition(state, id);
        return (
          !moAvailable(state, definition) ||
          (nation === "ah" && !italianTheaterActive(state))
        );
      });
      if (!locked.length) continue;
      state.mo.current[nation] = current.filter((id) => !locked.includes(id));
      for (const id of locked) {
        delete state.mo.progress[nation]?.[id];
        delete state.mo.drm_used[nation]?.[id];
        delete state.mo.targets[nation]?.[id];
      }
      state.mo.drawn[nation] = (state.mo.drawn[nation] || []).filter(
        (id) => !locked.includes(id),
      );
    }
  }
  if (previousVersion < 14 && state.pending_retreat) {
    const pending = state.pending_retreat;
    if (state.state === "advance") {
      pending.selected_advance_units = [];
      pending.advance_mode = "vacant";
      state.state = "advance_select";
    } else if (pending.overstack) {
      pending.overstack = {
        space: pending.overstack.space,
        group:
          pending.current_group || [pending.overstack.unit].filter(Boolean),
      };
      state.state = "retreat_overstack";
    } else if (["retreat", "retreat_offer"].includes(state.state)) {
      pending.selected_units = [];
      pending.group = null;
      pending.offer ||= null;
      if (pending.offer?.staged && !pending.offer.selected)
        pending.offer.selected = pending.offer.staged.slice();
      if (state.state === "retreat_offer" && pending.offer) {
        pending.offer.selected ||= [];
        const ids = pending.offer.units || pending.current_group || [];
        const first = state.units.find((unit) => unit.id === ids[0]);
        if (ids.length && first) {
          const remaining = Math.max(
            1,
            ...ids.map((id) => Number(pending.remaining?.[id]) || 0),
          );
          pending.group = {
            units: ids.slice(),
            path: (pending.paths?.[ids[0]] || [first.location]).slice(),
            total_steps: remaining,
            remaining_steps: remaining,
          };
          pending.offer.space = first.location;
        } else {
          pending.offer = null;
          pending.phase = "select";
          state.active = pending.faction;
          state.state = "retreat_select";
        }
      } else {
        pending.offer = null;
        pending.phase = "select";
        state.state = "retreat_select";
      }
    }
  }
  if (previousVersion < 24) {
    const turkey = state.events?.[cardById[703].event];
    if (
      turkey?.automatic &&
      !state.usage_limits["migration:703:auto-vp-refund"]
    ) {
      adjustVp(state, 1);
      state.usage_limits["migration:703:auto-vp-refund"] = 1;
    }
    const targetParisRevealed = state.combat?.played_cards?.some(
      (entry) => Number(entry?.id ?? entry) === 709,
    );
    if (targetParisRevealed) {
      for (const pool of [state.discard.cp, state.retained_combat_cards.cp]) {
        const index = pool.indexOf(709);
        if (index >= 0) pool.splice(index, 1);
      }
      if (!state.removed.cp.includes(709)) state.removed.cp.push(709);
    }
  }
  if (previousVersion < 25) {
    const inferAttackOrigin = () => ({
      kind:
        state.ops?.source === "mo_penalty"
          ? "mo_penalty"
          : state.ops?.source === "event"
            ? "event"
            : "normal",
      source: state.ops?.source_id ?? state.ops?.card ?? null,
    });
    if (state.ops?.pending_attack && !state.ops.pending_attack.attack_origin)
      state.ops.pending_attack.attack_origin = inferAttackOrigin();
    if (
      state.combat_window?.declaration &&
      !state.combat_window.declaration.attack_origin
    )
      state.combat_window.declaration.attack_origin = inferAttackOrigin();

    const ohlCard = cardById[713];
    const ohlPlayed =
      Boolean(state.events?.[ohlCard.event]) ||
      state.event_history.some((entry) => entry.card === 713);
    if (ohlPlayed) {
      const operation = cardSpecById[713]?.operations?.find(
        (entry) => entry.type === "mo_modify",
      );
      if (operation) applyMoModification(state, ohlCard, operation);
    }

    if (state.pending_event?.card === 719) {
      state.pending_event = null;
      for (const pool of [state.discard.cp, state.removed.cp]) {
        const index = pool.indexOf(719);
        if (index >= 0) pool.splice(index, 1);
      }
      if (!state.hands.cp.includes(719)) state.hands.cp.push(719);
      state.active = CP;
      state.state = "action_card";
      state.phase = "行动阶段";
    }
  }
  if (previousVersion < 15 && state.pending_retreat) {
    const pending = state.pending_retreat;
    pending.retreat_paths ||= [];
    pending.advance_max_steps ||= Math.max(
      1,
      Number(pending.steps) || 0,
      ...Object.values(pending.paths || {}).map((path) =>
        Math.max(0, (path?.length || 1) - 1),
      ),
    );
    // Version 14 offered an advance before every retreat step. Discard an
    // uncommitted offer and return control to the retreating player. Any
    // advance already committed on the board is preserved, but no second
    // post-retreat advance is granted during migration.
    if ((pending.advanced_ids || []).length) pending.advance_complete = true;
    if (state.state === "retreat_offer") {
      pending.offer = null;
      if (pending.group?.units?.length) {
        pending.phase = "move";
        state.active = pending.faction;
        state.state = "retreat_move";
      } else {
        pending.phase = "select";
        state.active = pending.faction;
        state.state = "retreat_select";
      }
    }
    if (["advance_select", "advance_destination"].includes(state.state)) {
      pending.advance_group ||= null;
      pending.selected_advance_units ||= [];
    }
  }
  if (
    previousVersion < 19 &&
    state.pending_event?.kind === "space_rule" &&
    state.pending_event.operation?.key === "hindenburg_line"
  ) {
    const pending = state.pending_event;
    const card = cardById[pending.card || 736];
    if (card) beginHindenburgLineEvent(state, card, pending.operation);
  }
  if (previousVersion < 20) {
    const lockedBritishMo = ["br-5", "br-6"].filter((id) => {
      const definition = moById[id];
      return definition && !moAvailable(state, definition);
    });
    if (lockedBritishMo.length) {
      state.mo.current.br = (state.mo.current.br || []).filter(
        (id) => !lockedBritishMo.includes(id),
      );
      state.mo.bag.br = (state.mo.bag.br || []).filter(
        (id) => !lockedBritishMo.includes(id),
      );
      state.mo.drawn.br = (state.mo.drawn.br || []).filter(
        (id) => !lockedBritishMo.includes(id),
      );
      for (const id of lockedBritishMo) {
        delete state.mo.progress.br?.[id];
        delete state.mo.drm_used.br?.[id];
        delete state.mo.targets.br?.[id];
      }
    }
    if (state.pending_event?.kind === "combat_repair")
      state.pending_event.units = combatRepairCandidates(
        state,
        state.pending_event,
      );
  }
  if (previousVersion < 21) {
    if (state.pending_event?.kind === "combat_fr_rp") {
      state.pending_event.gained ||= 0;
      state.pending_event.remaining ??= 2;
      state.pending_event.resume ||= "post_window";
      if (!state.pending_event.mode) state.pending_event.mode = "convert";
      delete state.pending_event.units;
    }
    if (state.pending_event?.kind === "mass_attrition") {
      const pending = state.pending_event;
      pending.selections ||= { ap: [], cp: [] };
      pending.initial ||= Object.fromEntries(
        [AP, CP].map((faction) => {
          const armies = state.units.filter(
            (unit) => unit.faction === faction && unit.type === "army",
          );
          return [
            faction,
            {
              full: armies
                .filter((unit) => !unit.reduced)
                .map((unit) => unit.id),
              reduced: armies
                .filter((unit) => unit.reduced)
                .map((unit) => unit.id),
            },
          ];
        }),
      );
      pending.stage ||= "losses";
    }
    if (
      state.naval?.event_queue?.some((entry) => entry.card === 636) &&
      !state.naval.resolving
    ) {
      state.naval.points.ap =
        state.naval.selections?.ap?.card === 636 ? 1 : state.naval.points.ap;
    }
  }
  if (previousVersion < 22) {
    const royalTanks = cardById[640]?.event;
    const diaz = cardById[641]?.event;
    if (royalTanks && state.events[royalTanks]) {
      const status = state.events[royalTanks];
      if (status.turn !== state.turn) delete state.events[royalTanks];
      else {
        status.duration = "action_round";
        status.cleanup = "action_round_end";
      }
    }
    if (diaz && state.events[diaz]) {
      state.events[diaz].duration = "until_used";
      state.events[diaz].cleanup = "used";
    }
    if (state.pending_event?.kind === "aef_replacements") {
      const pending = state.pending_event;
      if (pending.stage === "choice") pending.stage = "place";
      if (pending.stage === "ports") pending.stage = "place";
      pending.placements = (pending.placements || []).map((entry) => ({
        destination: entry.destination || "map",
        ...(entry.space ? { space: entry.space } : {}),
      }));
    }
  }
  if (previousVersion < 23) {
    if (state.pending_event?.kind === "activation_conversion") {
      state.pending_event = null;
      state.active = CP;
      state.state = state.ops?.execution_phase
        ? `ops_${state.ops.execution_phase}`
        : "ops_activate";
      if (state.ops) delete state.ops.activation_reaction_checked;
    }

    const apCommitmentRank =
      { mobilization: 0, limited: 1, total: 2 }[state.commitment.ap] ?? 0;
    const requiredCards = [651];
    if (apCommitmentRank >= 1) requiredCards.push(652, 653, 654, 655, 658);
    if (apCommitmentRank >= 2) requiredCards.push(650, 656, 657);
    const cardPresent = (id) =>
      [
        ...state.decks.ap,
        ...state.hands.ap,
        ...state.discard.ap,
        ...state.removed.ap,
        ...(state.retained_combat_cards.ap || []),
        ...Object.values(state.naval?.pending_fleet_cards || {}),
        ...(state.naval?.event_queue || []).map((entry) => entry.card),
        ...Object.values(state.naval?.selections || {}).map(
          (entry) => entry?.card,
        ),
        ...(state.combat_window?.cards || []),
        state.pending_event?.card,
      ].includes(id);
    const additions = requiredCards.filter((id) => !cardPresent(id));
    if (additions.length)
      state.decks.ap = shuffle(state, [...state.decks.ap, ...additions]);

    if (state.combat_window?.cards?.includes(658) && !state.combat) {
      const source = state.combat_window.card_sources?.[658] || "hand";
      for (const pool of [
        state.hands.ap,
        state.discard.ap,
        state.removed.ap,
        state.retained_combat_cards.ap,
      ]) {
        let index;
        while ((index = pool.indexOf(658)) >= 0) pool.splice(index, 1);
      }
      const destination =
        source === "retained"
          ? state.retained_combat_cards.ap
          : source === "discard"
            ? state.discard.ap
            : state.hands.ap;
      destination.push(658);
      state.combat_window.cards = state.combat_window.cards.filter(
        (id) => id !== 658,
      );
      delete state.combat_window.card_sources?.[658];
      delete state.events[cardById[658].event];
    }

    if (
      state.naval?.pending_fleet_cards?.ap === 658 &&
      state.commitment.ap === "total"
    ) {
      delete state.naval.pending_fleet_cards.ap;
      delete state.naval.dispositions?.ap;
      state.naval.disposition_order = (
        state.naval.disposition_order || []
      ).filter((side) => side !== AP);
      if (!state.removed.ap.includes(658)) state.removed.ap.push(658);
    }
  }
  if (previousVersion < 26) {
    const inApZone = [
      state.hands.ap,
      state.decks.ap,
      state.discard.ap,
      state.removed.ap,
      state.retained_combat_cards.ap,
    ].some((pool) => pool.includes(729));
    if (inApZone) state.card_owners[729] = AP;
    else if (!state.card_owners[729]) state.card_owners[729] = CP;

    if (state.commitment.ap === "total")
      delete state.events["cp_福克灾难_禁用空中优势"];
    if (state.events[cardById[643].event])
      delete state.events[cardById[723].event];
    else if (state.events[cardById[723].event])
      state.events[cardById[723].event].rule = clone(
        ruleModifier(cardById[723]),
      );
    if (
      state.events[cardById[636].event] &&
      state.turn_flags.turkish_front_locked === state.turn
    )
      delete state.turn_flags.turkish_front_locked;

    if (state.combat_window?.cards) {
      state.combat_window.card_owners ||= {};
      for (const id of state.combat_window.cards)
        state.combat_window.card_owners[id] =
          id === 729 ? state.card_owners[729] : cardById[id]?.faction;
    }
    for (const played of state.combat?.played_cards || [])
      if (played && typeof played === "object" && !played.faction)
        played.faction =
          played.id === 729
            ? state.card_owners[729]
            : cardById[played.id]?.faction;
  }
  if (previousVersion < 27) {
    const shortageMo = "br-8";
    const shortageSeen = [
      ...(state.mo.current?.br || []),
      ...(state.mo.bag?.br || []),
      ...(state.mo.drawn?.br || []),
      ...(state.mo.revealed || []),
      ...(state.mo.history || []).map((entry) => entry.id),
    ].includes(shortageMo);
    if (shortageSeen && !state.events["cp_英国炮弹短缺_MO解锁"])
      state.events["cp_英国炮弹短缺_MO解锁"] = {
        persistent: true,
        duration: "game",
        migrated: true,
        unlock_mo: shortageMo,
      };

    const first = "737:mo:german_attack_drm:1";
    const duplicate = "737:mo:german_attack_drm:2";
    const pool = state.mo.pool.ge || [];
    const duplicateEntry = pool.find((entry) => entry.id === duplicate);
    if (!pool.some((entry) => entry.id === first) && duplicateEntry)
      pool.push({ ...clone(duplicateEntry), id: first });
    state.mo.pool.ge = pool.filter((entry) => entry.id !== duplicate);
    for (const container of [
      state.mo.current,
      state.mo.bag,
      state.mo.drawn,
      state.mo.completed,
      state.mo.waived,
      state.mo.penalized,
    ]) {
      if (!container?.ge) continue;
      container.ge = unique(
        container.ge.map((id) => (id === duplicate ? first : id)),
      );
    }
    state.mo.revealed = unique(
      (state.mo.revealed || []).map((id) => (id === duplicate ? first : id)),
    );
    for (const container of [
      state.mo.progress,
      state.mo.drm_used,
      state.mo.targets,
    ]) {
      if (!container?.ge || !Object.hasOwn(container.ge, duplicate)) continue;
      if (!Object.hasOwn(container.ge, first))
        container.ge[first] = clone(container.ge[duplicate]);
      delete container.ge[duplicate];
    }
    for (const entry of state.mo.history || [])
      if (entry.id === duplicate) entry.id = first;

    if (
      state.pending_event?.kind === "nivelle_attacks" &&
      state.pending_event.loss_floor === 1
    ) {
      delete state.pending_event.loss_floor;
      state.pending_event.loss_adjust = -1;
    }
    if (state.ops?.forced_loss_floor === 1 && state.ops?.source === "nivelle") {
      delete state.ops.forced_loss_floor;
      state.ops.forced_loss_adjust = -1;
    }

    const boroevicPiece = "component-013";
    const boroevicExists = [
      state.units,
      state.reserves?.ap,
      state.reserves?.cp,
      state.upgrade_pool?.ap,
      state.upgrade_pool?.cp,
      state.eliminated?.ap,
      state.eliminated?.cp,
      state.hq_turn_track?.ap,
      state.hq_turn_track?.cp,
      state.permanently_removed_units,
    ].some((pool) => (pool || []).some((unit) => unit.piece === boroevicPiece));
    if (
      state.combat_window?.cards?.includes(732) &&
      !state.combat &&
      !state.usage_limits?.["combat_card_first:732"] &&
      !boroevicExists
    ) {
      state.combat_window.pending_hq_reinforcement ||= {
        kind: "combat_hq_reinforcement",
        card: 732,
        owner: CP,
        piece: boroevicPiece,
        placement: state.combat_window.attacker === CP ? "origin" : "target",
        required: true,
        resume: "resolve",
      };
    }
  }
  if (previousVersion < 28) {
    state.markers.salients ||= [];
    for (const cardId of [740, 744, 748]) {
      const card = cardById[cardId];
      const status = card && state.events[card.event];
      const markers = state.markers.salients.filter(
        (marker) => marker.source_card === cardId,
      );
      if (status && state.active === CP && markers.length) {
        status.salient_candidates = unique([
          ...(status.salient_candidates || []),
          ...markers.map((marker) => marker.space),
        ]);
        status.salient_resolved = false;
        state.markers.salients = state.markers.salients.filter(
          (marker) => marker.source_card !== cardId,
        );
      } else if (markers.length > 1) {
        let kept = false;
        state.markers.salients = state.markers.salients.filter((marker) => {
          if (marker.source_card !== cardId) return true;
          if (kept) return false;
          kept = true;
          return true;
        });
      }
    }

    const mutinyIds = new Set(
      (state.mo.pool.fr || [])
        .filter((entry) => entry.source_card === 743)
        .map((entry) => {
          delete entry.expires_turn;
          return entry.id;
        }),
    );
    for (const container of [state.mo.current, state.mo.drawn])
      if (container?.fr)
        container.fr = container.fr.filter((id) => !mutinyIds.has(id));
    state.mo.revealed = (state.mo.revealed || []).filter(
      (id) => !mutinyIds.has(id),
    );
    for (const container of [
      state.mo.progress,
      state.mo.drm_used,
      state.mo.targets,
    ])
      if (container?.fr) for (const id of mutinyIds) delete container.fr[id];

    if (
      state.pending_event?.kind === "reinforcement" &&
      [747, 749].includes(state.pending_event.card)
    ) {
      const pending = state.pending_event;
      const operation = cardSpecById[pending.card]?.operations?.find(
        (entry) => entry.type === "reinforcement",
      );
      if (operation) {
        pending.operation = clone(operation);
        const placed = new Set(
          (pending.placements || []).map(
            (entry) => `${entry.definition_index}:${entry.copy_index}`,
          ),
        );
        pending.queue = [];
        for (const [definitionIndex, definition] of operation.units.entries()) {
          const piece = pieceById[definition.piece];
          const reserveOptional =
            definition.to === "reserve" && piece?.type === "corps";
          if (definition.to !== "map" && !reserveOptional) continue;
          for (let copyIndex = 0; copyIndex < definition.count; copyIndex++) {
            if (placed.has(`${definitionIndex}:${copyIndex}`)) continue;
            pending.queue.push({
              piece: definition.piece,
              reduced: Boolean(definition.reduced),
              definition_index: definitionIndex,
              copy_index: copyIndex,
              reserve_optional: reserveOptional,
            });
          }
        }
        pending.index = 0;
      }
    }
  }
  if (previousVersion < 29) {
    const cpCommitmentRank =
      { mobilization: 0, limited: 1, total: 2 }[state.commitment.cp] ?? 0;
    const requiredCards = [751];
    if (cpCommitmentRank >= 1) requiredCards.push(752, 755, 756, 757, 758);
    const cardPresent = (id) =>
      [
        ...state.decks.cp,
        ...state.hands.cp,
        ...state.discard.cp,
        ...state.removed.cp,
        ...(state.retained_combat_cards.cp || []),
        ...Object.values(state.naval?.pending_fleet_cards || {}),
        ...(state.naval?.event_queue || []).map((entry) => entry.card),
        ...Object.values(state.naval?.selections || {}).map(
          (entry) => entry?.card,
        ),
        ...(state.combat_window?.cards || []),
        state.pending_event?.card,
      ].includes(id);
    const additions = requiredCards.filter((id) => !cardPresent(id));
    if (additions.length)
      state.decks.cp = shuffle(state, [...state.decks.cp, ...additions]);

    if (state.pending_event?.card === 752) {
      state.pending_event.locked = true;
      if (state.pending_event.kind === "card_search") {
        state.pending_event.kind = "white_feather_sr";
        state.pending_event.queue = ["fr", "br"];
        state.pending_event.index = 0;
        state.pending_event.unit = null;
        delete state.pending_event.cards;
        delete state.pending_event.after_search;
        state.active = AP;
        enterEventFlow(state);
      }
    }

    if (
      state.naval?.pending_fleet_cards?.cp === 758 &&
      state.commitment.cp === "total"
    ) {
      delete state.naval.pending_fleet_cards.cp;
      delete state.naval.dispositions?.cp;
      state.naval.disposition_order = (
        state.naval.disposition_order || []
      ).filter((side) => side !== CP);
      if (!state.removed.cp.includes(758)) state.removed.cp.push(758);
    }
  }
  if (previousVersion < 30 && state.pending_retreat) {
    const pending = state.pending_retreat;
    const migratedRetreatGroup =
      pending.group?.units?.slice() || pending.selected_units?.slice() || [];
    if (state.state === "retreat_move" && pending.group?.units?.length) {
      for (const id of pending.group.units) {
        if (pending.remaining?.[id] == null)
          pending.remaining[id] = Number(pending.group.remaining_steps) || 1;
        if (!pending.paths?.[id])
          pending.paths[id] = (pending.group.path || []).slice();
      }
    }
    if (
      ["retreat_select", "retreat_move", "retreat_offer"].includes(state.state)
    ) {
      state.state = "retreat";
      state.active = pending.faction;
    }
    pending.selected_units = migratedRetreatGroup;
    delete pending.selected_unit;
    delete pending.selected_distance;
    delete pending.group;
    delete pending.offer;
    delete pending.phase;
  }
  if (previousVersion < 31) {
    for (const entry of state.combat?.played_cards || []) {
      const id = Number(entry?.id ?? entry?.card ?? entry);
      if (
        Number.isInteger(id) &&
        !state.action_state.used_combat_cards.includes(id)
      )
        state.action_state.used_combat_cards.push(id);
    }
    if (state.pending_retreat?.overstack) {
      const pending = state.pending_retreat;
      const group = pending.overstack.group || [];
      pending.overstack.group = group.filter((id) =>
        pending.units?.includes(id),
      );
      pending.overstack.final =
        pending.overstack.final ??
        pending.overstack.group.every(
          (id) => Number(pending.remaining?.[id]) <= 0,
        );
    }
  }
  if (!state.last_action_use) state.last_action_use = { ap: null, cp: null };
  if (!state.reinforcement_events_this_turn)
    state.reinforcement_events_this_turn = { ap: [], cp: [] };
  if (previousVersion < 32) {
    if (state.state === "activation_units") state.state = "ops_activate";
    if (state.ops) {
      delete state.ops.pending_activation;
      for (const [space, kind] of Object.entries(state.activations || {}))
        if (kind === "both")
          state.activations[space] =
            state.ops.execution_phase === "attack" ? "attack" : "move";
    }
    if (
      state.state === "movement_units" &&
      state.ops?.move_selection?.selected?.length
    )
      state.state = "movement_units";
    if (state.pending_retreat) {
      const pending = state.pending_retreat;
      pending.selected_units = pending.selected_units?.length
        ? pending.selected_units.slice()
        : [pending.selected_unit].filter(Boolean);
    }
    updateSupply(state);
  }
  if (previousVersion < 33) {
    // Version 33 changes the printed asterisk to POG semantics: removal on
    // Event/Combat use only.  Migrate only cards whose prior Event use is
    // provable; an ambiguous discard may have come from OPS, SR, RP, or Fleet.
    const eventCards = new Set(
      state.event_history
        .map((entry) => Number(entry?.card))
        .filter((id) => cardById[id]?.remove),
    );
    for (const faction of [AP, CP]) {
      for (const id of eventCards) {
        if (cardById[id]?.faction !== faction) continue;
        const index = state.discard[faction].indexOf(id);
        if (index < 0) continue;
        state.discard[faction].splice(index, 1);
        if (!state.removed[faction].includes(id))
          state.removed[faction].push(id);
      }
    }

    // Royal Tank Corps lost its printed removal mark.  Its prior location is
    // unambiguous, so restore it to the ordinary discard pile.
    const royalTankIndex = state.removed.ap.indexOf(640);
    if (royalTankIndex >= 0) {
      state.removed.ap.splice(royalTankIndex, 1);
      if (!state.discard.ap.includes(640)) state.discard.ap.push(640);
    }
  }
  if (previousVersion < 34) CardZones.migrateV34(state);
  if (previousVersion < 35 && state.pending_retreat) {
    const pending = state.pending_retreat;
    if (!Array.isArray(pending.selected_units))
      pending.selected_units = [pending.selected_unit].filter(Boolean);
    delete pending.selected_unit;
    delete pending.selected_distance;
  }
  if (previousVersion < 35 && state.combat) {
    state.combat.move_attackers ||= (state.combat.attackers || []).filter(
      (id) => {
        const unit = state.units.find((candidate) => candidate.id === id);
        return unit && isCombatUnit(unit) && unit.moved && unit.attack_eligible;
      },
    );
    if (state.pending_retreat?.advance_units) {
      const moved = new Set(state.combat.move_attackers);
      state.pending_retreat.advance_units =
        state.pending_retreat.advance_units.filter((id) => !moved.has(id));
    }
  }
  // August Guns used to destroy a Belgian fort before placing the CP stack,
  // leaving some saves with an uncontested destroyed fort still controlled by
  // its printed owner.  This is a safe invariant repair rather than a schema
  // migration, so it also fixes already-current saves as soon as they load.
  let repairedDestroyedFortControl = false;
  for (const space of state.destroyed_forts || []) {
    const occupiers = unique(
      state.units
        .filter((unit) => unit.location === space && isCombatUnit(unit))
        .map((unit) => unit.faction),
    );
    if (occupiers.length === 1 && state.control[space] !== occupiers[0]) {
      captureSpace(state, space, occupiers[0]);
      repairedDestroyedFortControl = true;
    }
  }
  if (repairedDestroyedFortControl) updateSupply(state);
  if (!Array.isArray(state.rollback)) state.rollback = [];
  for (const entry of state.rollback) {
    if (!Number.isInteger(entry.log_cursor))
      entry.log_cursor = Array.isArray(entry.state?.log)
        ? entry.state.log.length
        : 0;
  }
  if (previousVersion < 36) {
    if (state.pending_retreat) {
      state.pending_retreat.selected_units ||= [];
      state.pending_retreat.selected_advance_units ||= [];
    }
  }
  if (previousVersion < 37 && state.state === "confirm_attack")
    state.state = "attack_mo";
  if (previousVersion < 38) {
    for (const faction of [AP, CP]) {
      const retained = [];
      for (const unit of state.eliminated[faction] || []) {
        if (!pieceById[unit.piece]?.permanent_on_elimination) {
          retained.push(unit);
          continue;
        }
        if (
          !(state.permanently_removed_units || []).some(
            (entry) => entry.id === unit.id,
          )
        )
          state.permanently_removed_units.push({
            ...unit,
            removed_by: "v38_piece_rule_migration",
            removed_turn: state.turn,
          });
      }
      state.eliminated[faction] = retained;
    }
    const pending = state.pending_event;
    if (
      pending?.kind === "replacement_rebuild" &&
      !state.eliminated[pending.faction]?.some(
        (unit) => unit.id === pending.unit,
      )
    ) {
      const resume = pending.resume_immediate_rp || pending.resume_combat_fr_rp;
      if (resume) {
        state.pending_event = resume;
        enterEventFlow(state);
        state.phase = "行动阶段";
      } else {
        state.pending_event = null;
        state.state = pending.resume_state || "replacement";
        state.phase = pending.resume_phase || "补员/升级";
      }
      state.active = pending.faction;
    }
  }
  if (previousVersion < 39) {
    const pending = state.pending_event;
    if (
      pending?.kind === "mo_penalty" &&
      ["origin", "target", "confirm"].includes(pending.stage)
    ) {
      const selected = (pending.selected || [])
        .map((entry) => (typeof entry === "string" ? entry : entry?.origin))
        .filter(Boolean);
      if (pending.origin) selected.push(pending.origin);
      pending.selected = [...new Set(selected)].slice(0, pending.required || 2);
      pending.stage =
        pending.selected.length >= (pending.required || 2)
          ? "confirm"
          : "origin";
      delete pending.origin;
    }
    if (pending?.kind === "mo_penalty" || state.ops?.source === "mo_penalty")
      delete state.ops.forced_targets;
  }
  if (previousVersion < 40) {
    const normalizeOffMap = (unit) => {
      if (!unit || typeof unit !== "object") return;
      for (const key of [
        "location",
        "supplied",
        "limited_supply",
        "fort_limited_supply",
        "moved",
        "attacked",
        "attack_eligible",
      ])
        delete unit[key];
    };
    for (const faction of [AP, CP]) {
      for (const pool of [
        state.reserves?.[faction],
        state.upgrade_pool?.[faction],
        state.eliminated?.[faction],
        state.hq_turn_track?.[faction],
      ])
        for (const unit of pool || []) normalizeOffMap(unit);
    }
    for (const pool of [
      state.permanently_removed_units,
      ...Object.values(state.entry_reserve || {}),
    ])
      for (const unit of pool || []) normalizeOffMap(unit);

    const pending = state.pending_event;
    if (pending?.kind === "front_maintenance") {
      const obligation = pending.obligations?.[pending.index];
      if (obligation && !obligation.automatic_payment_done) {
        if (pending.credit?.remaining > 0 && obligation.remaining > 0) {
          const paid = Math.min(pending.credit.remaining, obligation.remaining);
          pending.credit.remaining -= paid;
          obligation.remaining = Math.max(0, obligation.remaining - paid);
        }
        const nativeKey =
          obligation.pool === "east"
            ? "east"
            : obligation.pool === "ah"
              ? "ah"
              : null;
        if (nativeKey && obligation.remaining > 0) {
          const paid = Math.min(
            state.rp[obligation.faction]?.[nativeKey] || 0,
            obligation.remaining,
          );
          state.rp[obligation.faction][nativeKey] -= paid;
          obligation.remaining = Math.max(0, obligation.remaining - paid);
        }
        obligation.automatic_payment_done = true;
      }
    }
    if (
      pending?.kind === "front_investment" &&
      !pending.automatic_payment_done
    ) {
      if (pending.track === "russian" && pending.paid < pending.cost - 1e-9) {
        const remaining = pending.cost - pending.paid;
        const cashAvailable = Object.entries(pending.rates || {}).reduce(
          (sum, [key, rate]) =>
            sum + (state.rp[pending.faction]?.[key] || 0) * rate,
          0,
        );
        const paymentLimit =
          pending.mo || cashAvailable >= remaining - 1e-9
            ? remaining
            : Math.min(remaining, Math.max(0, 1 - pending.paid));
        const paid = Math.min(
          state.rp[pending.faction]?.east || 0,
          paymentLimit,
        );
        state.rp[pending.faction].east -= paid;
        pending.paid += paid;
      }
      pending.automatic_payment_done = true;
    }
  }
  if (previousVersion < 42) {
    const pending = state.pending_event;
    if (pending?.kind === "veteran_upgrade") {
      if (pending.source_zone === "reserve") {
        if (pending.resume_immediate_rp || pending.resume_combat_fr_rp) {
          state.pending_event =
            pending.resume_immediate_rp || pending.resume_combat_fr_rp;
          enterEventFlow(state);
          state.phase = "行动阶段";
        } else {
          state.pending_event = null;
          state.state = pending.resume_state || "replacement";
          state.phase = pending.resume_phase || "补员/升级";
        }
      } else {
        pending.formal_replacement = !(
          pending.resume_immediate_rp || pending.resume_combat_fr_rp
        );
        delete pending.cost;
        delete pending.token;
        delete pending.usage_key;
        delete pending.nation;
        delete pending.unit_type;
      }
    }
    for (const faction of [AP, CP])
      if (
        state.commitment?.[faction] !== "mobilization" &&
        !state.usage_limits[`veteran_pool:${faction}`]
      )
        Engine.populateVeteranUpgradePool(state, faction);
  }
  if (previousVersion < 43) state.undo = [];
  if (previousVersion < 44) {
    const convertedUndo = [];
    let undoSafe = Array.isArray(state.undo);
    for (const entry of state.undo || []) {
      if (!entry?.state || typeof entry.state !== "object") {
        undoSafe = false;
        break;
      }
      const logCursor = Number.isInteger(entry.log_cursor)
        ? entry.log_cursor
        : Array.isArray(entry.state.log)
          ? entry.state.log.length
          : null;
      if (!Number.isInteger(logCursor)) {
        undoSafe = false;
        break;
      }
      convertedUndo.push({
        label: entry.label || "撤销",
        turn: entry.turn ?? entry.state.turn,
        round: entry.round ?? entry.state.action_round,
        actor: entry.actor ?? entry.state.active,
        log_cursor: logCursor,
        state: compactHistoryState(entry.state),
      });
    }
    state.undo = undoSafe ? convertedUndo : [];

    const legacyRollback = state.rollback || [];
    const encodedRollback = decodeRollbackStates(state.rollback_state);
    const rollbackSnapshots = [];
    state.rollback = legacyRollback.map((entry, index) => {
      const snapshotState = entry?.state || encodedRollback[index];
      if (!snapshotState)
        throw new Error(
          `Cannot migrate rollback checkpoint: ${entry?.label || "unknown"}`,
        );
      rollbackSnapshots.push(compactHistoryState(snapshotState));
      return {
        turn: entry.turn ?? snapshotState.turn,
        round: entry.round ?? snapshotState.action_round,
        actor: entry.actor ?? snapshotState.active,
        kind: entry.kind || "action",
        label: entry.label || "检查点",
        log_cursor: Number.isInteger(entry.log_cursor)
          ? entry.log_cursor
          : Array.isArray(entry.state?.log)
            ? entry.state.log.length
            : 0,
      };
    });
    setRollbackSnapshots(state, rollbackSnapshots);
    canonicalizeEventState(state);
  }
  if (previousVersion < 45) {
    const actor = state.action_state?.actor;
    const inFormalAction =
      [AP, CP].includes(actor) &&
      Number(state.action_round) > 0 &&
      state.action_state?.turn === state.turn &&
      state.action_state?.round === state.action_round;
    if (inFormalAction) {
      const legacyCpSnapshot =
        actor === CP &&
        state.round_start_control &&
        Object.keys(state.round_start_control).length
          ? state.round_start_control
          : null;
      state.action_start_control = {
        actor,
        spaces: clone(legacyCpSnapshot || state.control || {}),
      };
    } else {
      state.action_start_control = null;
    }
    delete state.round_start_control;
    delete state.round_enemy_entries;
  }
  if (previousVersion < 46) {
    state.campaign_flags ||= { paris_attacked: false };
    state.campaign_flags.paris_attacked = Boolean(
      state.campaign_flags.paris_attacked,
    );
    if (state.ops) {
      state.ops.attack_marker_spaces = [
        ...new Set([
          ...(state.ops.attack_marker_spaces || []),
          ...Object.entries(state.activations || {})
            .filter(([, kind]) => kind === "attack")
            .map(([space]) => space),
          ...Object.entries(state.ops.region_activations?.attack || {})
            .filter(([, stacks]) => stacks?.length)
            .map(([space]) => space),
        ]),
      ];
    }
    const penalty = state.pending_event;
    if (penalty?.kind === "mo_penalty" &&
        ["forward_origin", "forward_leave", "forward_target"].includes(penalty.stage)) {
      penalty.stage = "mode";
      delete penalty.origin;
      delete penalty.leave;
      delete penalty.forward_available;
      penalty.selected = [];
      penalty.selected_units = [];
      penalty.loss_required = Engine.moPenaltyLossCanPay(
        state,
        penalty.penalized,
        penalty.nation,
        2,
      ) ? 2 : 0;
    }
    updateSupply(state);
  }
  {
    const remapReinforcementPiece = (piece, sourceCard) => {
      if (Number(sourceCard) === 637) {
        if (piece === "component-093") return "component-170";
        if (piece === "component-026") return "component-169";
      }
      if (Number(sourceCard) === 735 && piece === "component-033")
        return "component-167";
      return piece;
    };
    const migrateUnit = (unit) => {
      if (!unit || typeof unit !== "object") return;
      unit.piece = remapReinforcementPiece(
        unit.piece,
        unit.reinforcement_card,
      );
    };
    const pools = [
      state.units,
      state.permanently_removed_units,
      ...Object.values(state.reserves || {}),
      ...Object.values(state.upgrade_pool || {}),
      ...Object.values(state.eliminated || {}),
      ...Object.values(state.hq_turn_track || {}),
      ...Object.values(state.entry_reserve || {}),
      ...(state.scheduled_events || []).map((entry) => entry.units),
    ];
    for (const pool of pools)
      for (const unit of pool || []) migrateUnit(unit);

    const pending = state.pending_event;
    if ([637, 735].includes(Number(pending?.card))) {
      const remap = (entry) => {
        if (entry && typeof entry === "object" && entry.piece)
          entry.piece = remapReinforcementPiece(entry.piece, pending.card);
      };
      for (const entry of pending.queue || []) remap(entry);
      for (const entry of pending.placements || []) remap(entry);
      for (const entry of pending.operation?.units || []) remap(entry);
      if (Array.isArray(pending.operation?.exchange?.incoming_pieces))
        pending.operation.exchange.incoming_pieces =
          pending.operation.exchange.incoming_pieces.map((piece) =>
            remapReinforcementPiece(piece, pending.card),
          );
    }
  }
  if (
    state.action_start_control &&
    (![AP, CP].includes(state.action_start_control.actor) ||
      !state.action_start_control.spaces ||
      typeof state.action_start_control.spaces !== "object")
  )
    state.action_start_control = null;
  state.version = 46;
  if (AUTO_CARD_CONSERVATION) CardZones.assertCardConservation(state);
  return state;
}

function random(state) {
  let value = Number(state.seed) >>> 0;
  value = (value + 0x6d2b79f5) >>> 0;
  let mixed = value;
  mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  state.seed = value;
  return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
}

function roll(state, sides = 6) {
  return Math.floor(random(state) * sides) + 1;
}

function shuffle(state, items) {
  const result = items.slice();
  for (let index = result.length - 1; index > 0; index--) {
    const target = Math.floor(random(state) * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function log(state, message) {
  state.log.push(message);
}

function snapshot(state, label) {
  if (undoActionContext?.state === state && undoActionContext.suppress)
    return null;
  if (undoActionContext?.state === state && undoActionContext.snapshotTaken) {
    if (undoActionContext.deterministic) return undoActionContext.entry;
    throw new Error("duplicate undo point");
  }
  const source = clone(
    undoActionContext?.state === state && undoActionContext.before
      ? undoActionContext.before
      : state,
  );
  const entry = {
    label,
    turn: state.turn,
    round: state.action_round,
    actor: state.active,
    log_cursor: Array.isArray(source.log) ? source.log.length : 0,
    state: compactHistoryState(source),
  };
  state.undo.push(entry);
  if (undoActionContext?.state === state) {
    undoActionContext.entry = entry;
    undoActionContext.snapshotTaken = true;
  }
  return entry;
}

function clearUndo(state) {
  if (Array.isArray(state?.undo)) state.undo.length = 0;
  if (undoActionContext?.state === state) undoActionContext.entry = null;
}

function advanceRestoringState(state) {
  const previous = undoActionContext;
  undoActionContext = { state, suppress: true };
  try {
    Engine.advanceDeterministicStates(state, { restoring: true });
    if (!Engine.hasState(state.state))
      throw new Error(`Unregistered stable state after restore: ${state.state}`);
  } finally {
    undoActionContext = previous;
  }
}

function undoAvailable(state) {
  const entry = state.undo?.at(-1);
  if (!entry) return false;
  const turn = entry.turn ?? entry.state?.turn;
  const round = entry.round ?? entry.state?.action_round;
  const actor = entry.actor ?? entry.state?.active;
  return (
    turn === state.turn &&
    round === state.action_round &&
    actor === state.active
  );
}

function restoreSnapshot(state, entry) {
  const undo = state.undo;
  const rollback = state.rollback;
  const rollbackState = state.rollback_state;
  const log = Array.isArray(state.log) ? state.log : [];
  const cursor = Number.isInteger(entry?.log_cursor)
    ? entry.log_cursor
    : Array.isArray(entry?.state?.log)
      ? entry.state.log.length
      : log.length;
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, clone(entry.state));
  state.undo = undo;
  state.rollback = rollback;
  state.rollback_state = rollbackState;
  state.log = log.slice(0, cursor);
}

function checkpoint(state, kind, label) {
  const snapshots = decodeRollbackStates(state.rollback_state);
  state.rollback.push({
    turn: state.turn,
    round: state.action_round,
    actor: state.active,
    kind,
    label,
    log_cursor: state.log.length,
  });
  snapshots.push(compactHistoryState(state));
  const max = Number(state.options.max_rollback_points || 14);
  while (state.rollback.length > max) {
    state.rollback.shift();
    snapshots.shift();
  }
  setRollbackSnapshots(state, snapshots);
}

function set_up_historical_scenario() {
  const scenario = {
    units: [],
    reserves: { ap: [], cp: [] },
    upgrade_pool: { ap: [], cp: [] },
  };
  const zoneByBox = {
    "AP Reserve Box": ["reserves", AP, "ap_reserve"],
    "CP Reserve Box": ["reserves", CP, "cp_reserve"],
    "AP Upgrade Pool": ["upgrade_pool", AP, "ap_upgrade"],
    "CP Upgrade Pool": ["upgrade_pool", CP, "cp_upgrade"],
  };
  const setup_piece = (nation, unit, space, reduced = false) => {
    const unitName = String(unit).trim();
    const matches = data.pieces.filter(
      (piece) =>
        piece.nation === nation &&
        (piece.name === unitName || piece.id === unitName) &&
        ["army", "corps", "hq"].includes(piece.type),
    );
    if (matches.length !== 1)
      throw new Error(
        `Historical setup piece is not unique: ${nation} ${unitName} (${matches.length} matches)`,
      );
    const piece = matches[0];
    const faction =
      piece.faction || (["ge", "ah"].includes(piece.nation) ? CP : AP);
    const box = zoneByBox[space];
    if (box) {
      const [poolName, poolFaction, idPrefix] = box;
      if (faction !== poolFaction)
        throw new Error(
          `Historical setup faction mismatch: ${unit} -> ${space}`,
        );
      const pool = scenario[poolName][poolFaction];
      pool.push({
        id: `${idPrefix}-${pool.length + 1}`,
        piece: piece.id,
        reduced: Boolean(reduced),
      });
      return;
    }
    const spaceKey = String(space);
    const location =
      spaceById[spaceKey]?.id ||
      spaceById[spaceKey.toLowerCase()]?.id ||
      data.spaces.find(
        (candidate) => candidate.name.toLowerCase() === spaceKey.toLowerCase(),
      )?.id;
    if (!location)
      throw new Error(`Historical setup space does not exist: ${space}`);
    scenario.units.push({
      id: `u${String(scenario.units.length + 1).padStart(3, "0")}`,
      piece: piece.id,
      faction,
      nation: piece.nation,
      type: piece.type,
      location,
      reduced: Boolean(reduced),
      moved: false,
      attacked: false,
      supplied: true,
      limited_supply: false,
    });
  };

  // Map setup. Edit the printed space name in the third argument; no coordinates or TTS objects are used.
  setup_piece("it", "意大利新兵scu", "Udine", true);
  setup_piece("it", "意大利新兵", "Udine", true);
  setup_piece("it", "意大利新兵", "Udine", true);
  setup_piece("it", "意大利新兵", "Palmanova", true);
  setup_piece("it", "意大利新兵", "Palmanova", true);
  setup_piece("it", "意大利新兵骑兵", "Tolmezzo", true);
  setup_piece("it", "意大利新兵山地scu", "Tolmezzo", true);
  setup_piece("it", "意大利新兵", "Belluno", true);
  setup_piece("it", "意大利新兵山地scu", "Belluno", true);
  setup_piece("it", "意大利新兵", "Vittorio", true);
  setup_piece("it", "意大利新兵山地scu", "Vittorio", true);
  setup_piece("it", "意大利新兵", "Treviso", true);
  setup_piece("it", "意大利新兵", "Veneto", true);
  setup_piece("it", "意大利新兵", "Vicenza");
  setup_piece("it", "意大利新兵", "Verona");
  setup_piece("it", "意大利新兵骑兵scu", "Verona");
  setup_piece("it", "意大利新兵scu", "Venice");
  setup_piece("it", "意大利新兵", "Asiago", true);
  setup_piece("it", "意大利新兵", "Asiago", true);
  setup_piece("it", "意大利新兵scu", "Asiago");
  setup_piece("ah", "奥匈新兵山地scu", "Bozen");
  setup_piece("ah", "奥匈新兵山地scu", "Lienz");
  setup_piece("ah", "奥匈新兵山地scu", "Spittal");
  setup_piece("ah", "奥匈新兵山地scu", "Caporetto");
  setup_piece("ah", "奥匈新兵scu", "Gorizia");
  setup_piece("ah", "奥匈新兵scu", "Gorizia");
  setup_piece("ah", "奥匈新兵", "Trent");
  setup_piece("ah", "奥匈新兵scu", "Rovereto");
  setup_piece("be", "比利时新兵scu", "Antwerp");
  setup_piece("be", "比利时新兵scu", "Ghent");
  setup_piece("be", "比利时新兵scu", "Brussels");
  setup_piece("be", "比利时新兵scu", "Liege");
  setup_piece("be", "比利时新兵scu", "Namur");
  setup_piece("be", "比利时新兵scu", "Mons");
  setup_piece("be", "比利时新兵骑兵scu", "Brussels");
  setup_piece("be", "G阿尔贝特", "Brussels");
  setup_piece("fr", "法国新兵", "Belfort");
  setup_piece("fr", "法国新兵", "Epinal");
  setup_piece("fr", "法国新兵", "St. Die");
  setup_piece("fr", "法国新兵骑兵scu", "St. Die");
  setup_piece("fr", "法国新兵", "Epinal");
  setup_piece("fr", "法国新兵", "Charmes");
  setup_piece("fr", "法国新兵", "Lomevillie");
  setup_piece("fr", "法国新兵", "Lomevillie");
  setup_piece("fr", "法国新兵", "St. Die");
  setup_piece("fr", "法国新兵", "Nancy");
  setup_piece("fr", "法国新兵", "Nancy");
  setup_piece("fr", "法国新兵", "Toul");
  setup_piece("fr", "法国新兵", "Toul");
  setup_piece("fr", "法国新兵", "Verdun");
  setup_piece("fr", "法国新兵", "verdun");
  setup_piece("fr", "法国新兵", "Sedan");
  setup_piece("fr", "法国新兵", "Sedan");
  setup_piece("fr", "法国新兵", "Mezieres");
  setup_piece("fr", "法国新兵", "Vervins");
  setup_piece("fr", "法国新兵", "Vervins");
  setup_piece("fr", "法国新兵", "Saint-Mihiel");
  setup_piece("fr", "法国新兵骑兵scu", "Saint-Mihiel");
  setup_piece("fr", "法国新兵山地scu", "Belfort");
  setup_piece("fr", "法国新兵scu", "Vitry-le-Francois");
  setup_piece("fr", "法国新兵scu", "Vitry-le-Francois");
  setup_piece("fr", "G霞飞", "Vitry-le-Francois");
  setup_piece("fr", "法国外籍新兵", "Ardennes");
  setup_piece("fr", "法国新兵骑兵scu", "Ardennes");
  setup_piece("fr", "法国新兵骑兵scu", "Mezieres");
  setup_piece("fr", "法国新兵骑兵scu", "Charmes");
  setup_piece("fr", "法国新兵骑兵scu", "Lomevillie");
  setup_piece("fr", "法国新兵骑兵scu", "Epinal");
  setup_piece("fr", "法国新兵scu", "Charmes");
  setup_piece("fr", "法国新兵scu", "Nancy");
  setup_piece("fr", "法国新兵scu", "Toul");
  setup_piece("fr", "法国新兵山地scu", "Belfort");
  setup_piece("fr", "法国外籍新兵scu", "Verdun");
  setup_piece("ge", "德国新兵", "Dusseldorf");
  setup_piece("ge", "德国新兵", "Dusseldorf");
  setup_piece("ge", "德国骑兵scu", "Dusseldorf");
  setup_piece("ge", "G克卢克", "Dusseldorf");
  setup_piece("ge", "德国新兵", "Essen");
  setup_piece("ge", "德国新兵", "Essen");
  setup_piece("ge", "德国新兵scu", "Essen");
  setup_piece("ge", "德国新兵", "Aachen");
  setup_piece("ge", "德国新兵", "Aachen");
  setup_piece("ge", "德国骑兵scu", "Aachen");
  setup_piece("ge", "德国骑兵scu", "Schirches");
  setup_piece("ge", "普鲁士新兵scu", "Schirches");
  setup_piece("ge", "普鲁士新兵", "Schirches");
  setup_piece("ge", "德国骑兵scu", "Hillesheim");
  setup_piece("ge", "萨克森新兵scu", "Hillesheim");
  setup_piece("ge", "萨克森新兵", "Hillesheim");
  setup_piece("ge", "德国新兵", "Bitburg");
  setup_piece("ge", "萨克森新兵", "Bitburg");
  setup_piece("ge", "普鲁士骑兵scu", "Bitburg");
  setup_piece("ge", "德国新兵", "Wiltz");
  setup_piece("ge", "德国新兵scu", "Wiltz");
  setup_piece("ge", "德国骑兵scu", "Wiltz");
  setup_piece("ge", "德国新兵", "Luxembourg");
  setup_piece("ge", "德国新兵", "Luxembourg");
  setup_piece("ge", "德国新兵scu", "Luxembourg");
  setup_piece("ge", "德国新兵", "Metz");
  setup_piece("ge", "符腾堡新兵", "Metz");
  setup_piece("ge", "德国新兵scu", "Metz");
  setup_piece("ge", "G皇储威廉", "Metz");
  setup_piece("ge", "德国新兵", "Saarbrucken");
  setup_piece("ge", "德国新兵scu", "Saarbrucken");
  setup_piece("ge", "德国骑兵scu", "Saarbrucken");
  setup_piece("ge", "巴伐利亚新兵", "Marfeuilles");
  setup_piece("ge", "巴伐利亚新兵", "Marfeuilles");
  setup_piece("ge", "巴伐利亚新兵骑兵scu", "Marfeuilles");
  setup_piece("ge", "G鲁普雷希特", "Marfeuilles");
  setup_piece("ge", "巴伐利亚新兵", "Sarrebourg");
  setup_piece("ge", "德国骑兵scu", "Sarrebourg");
  setup_piece("ge", "德国骑兵scu", "Sarrebourg");
  setup_piece("ge", "德国新兵", "Strasbourg");
  setup_piece("ge", "德国新兵", "Strasbourg");
  setup_piece("ge", "德国新兵scu", "Strasbourg");
  setup_piece("ge", "德国新兵", "Colmar");
  setup_piece("ge", "德国新兵scu", "Mulhouse");
  setup_piece("ge", "符腾堡新兵山地scu", "Mulhouse");
  // Reserve boxes.
  setup_piece("fr", "法国新兵scu", "AP Reserve Box");
  setup_piece("fr", "法国新兵scu", "AP Reserve Box");
  setup_piece("fr", "法国新兵scu", "AP Reserve Box");
  setup_piece("fr", "法国新兵scu", "AP Reserve Box");
  setup_piece("fr", "法国新兵scu", "AP Reserve Box");
  setup_piece("fr", "法国新兵scu", "AP Reserve Box");
  setup_piece("fr", "法国新兵scu", "AP Reserve Box");
  setup_piece("fr", "法国新兵scu", "AP Reserve Box");
  setup_piece("fr", "法国新兵骑兵scu", "AP Reserve Box");
  setup_piece("fr", "法国新兵骑兵scu", "AP Reserve Box");
  setup_piece("fr", "法国新兵骑兵scu", "AP Reserve Box");
  setup_piece("fr", "法国外籍新兵scu", "AP Reserve Box");
  setup_piece("fr", "法国外籍新兵scu", "AP Reserve Box");
  setup_piece("fr", "法国外籍新兵scu", "AP Reserve Box");
  setup_piece("it", "意大利新兵骑兵scu", "AP Reserve Box");
  setup_piece("it", "意大利新兵scu", "AP Reserve Box");
  setup_piece("it", "意大利新兵scu", "AP Reserve Box");
  setup_piece("it", "意大利新兵scu", "AP Reserve Box");
  setup_piece("it", "意大利新兵scu", "AP Reserve Box");
  setup_piece("it", "意大利新兵scu", "AP Reserve Box");
  setup_piece("it", "意大利新兵scu", "AP Reserve Box");
  setup_piece("br", "英国新兵scu", "AP Reserve Box");
  setup_piece("ah", "奥匈新兵scu", "CP Reserve Box");
  setup_piece("ah", "奥匈新兵scu", "CP Reserve Box");
  setup_piece("ge", "德国新兵scu", "CP Reserve Box");
  setup_piece("ge", "德国新兵scu", "CP Reserve Box");
  setup_piece("ge", "德国新兵scu", "CP Reserve Box");
  setup_piece("ge", "德国新兵scu", "CP Reserve Box");
  setup_piece("ge", "德国新兵scu", "CP Reserve Box");
  setup_piece("ge", "德国新兵scu", "CP Reserve Box");
  setup_piece("ge", "德国新兵scu", "CP Reserve Box");
  setup_piece("ge", "德国新兵scu", "CP Reserve Box");
  setup_piece("ge", "巴伐利亚新兵scu", "CP Reserve Box");
  setup_piece("ge", "巴伐利亚新兵scu", "CP Reserve Box");
  setup_piece("ge", "普鲁士新兵scu", "CP Reserve Box");
  setup_piece("ge", "萨克森新兵scu", "CP Reserve Box");
  // Veteran and upgrade pools.
  setup_piece("fr", "法国老兵", "AP Upgrade Pool");
  setup_piece("fr", "法国老兵scu", "AP Upgrade Pool");
  setup_piece("fr", "法国老兵scu", "AP Upgrade Pool");
  setup_piece("fr", "法国老兵scu", "AP Upgrade Pool");
  setup_piece("fr", "法国老兵", "AP Upgrade Pool");
  setup_piece("br", "英国老兵", "AP Upgrade Pool");
  setup_piece("br", "英国老兵scu", "AP Upgrade Pool");
  setup_piece("br", "英国老兵scu", "AP Upgrade Pool");
  setup_piece("br", "英国老兵scu", "AP Upgrade Pool");
  setup_piece("ge", "德国老兵scu", "CP Upgrade Pool");
  setup_piece("ge", "德国老兵scu", "CP Upgrade Pool");
  setup_piece("ge", "德国老兵scu", "CP Upgrade Pool");
  setup_piece("ge", "德国老兵scu", "CP Upgrade Pool");
  setup_piece("ge", "德国老兵scu", "CP Upgrade Pool");
  setup_piece("ge", "德国老兵scu", "CP Upgrade Pool");
  setup_piece("ge", "德国老兵", "CP Upgrade Pool");
  setup_piece("ge", "德国老兵scu", "CP Upgrade Pool");
  setup_piece("ge", "德国老兵", "CP Upgrade Pool");
  setup_piece("ge", "德国老兵", "CP Upgrade Pool");
  setup_piece("ge", "德国老兵", "CP Upgrade Pool");
  setup_piece("ge", "德国老兵", "CP Upgrade Pool");

  return scenario;
}

function createState(seed, options = {}) {
  const historicalSetup = set_up_historical_scenario();
  const startingUnits = historicalSetup.units;
  const italianEntryUnits = startingUnits.filter(
    (unit) => unit.nation === "it",
  );
  return {
    version: 46,
    seed: Number(seed) >>> 0,
    scenario: HISTORICAL,
    options: {
      max_rollback_points: 14,
      enforce_supply: true,
      ...options,
    },
    state: "opening_ap_card",
    phase: "开局选牌",
    active: AP,
    turn: 1,
    action_round: 0,
    first_player: CP,
    log: [],
    undo: [],
    rollback: [],
    rollback_state: encodeRollbackStates([]),
    supply_warnings: null,
    supply_warning_editor: null,
    pending_supply_warning_review: null,
    rollback_proposal: null,
    rollback_confirmation: null,
    action_history: [],
    opening: {},
    action_state: null,
    last_action_use: { ap: null, cp: null },
    reinforcement_events_this_turn: { ap: [], cp: [] },
    action_start_control: null,
    units: startingUnits.filter((unit) => unit.nation !== "it"),
    entry_reserve: {
      it: italianEntryUnits,
    },
    reserves: {
      ap: historicalSetup.reserves.ap,
      cp: historicalSetup.reserves.cp,
    },
    upgrade_pool: {
      ap: historicalSetup.upgrade_pool.ap,
      cp: historicalSetup.upgrade_pool.cp,
    },
    control: Object.fromEntries(
      data.spaces.map((space) => [
        space.id,
        space.control || space.faction || null,
      ]),
    ),
    trenches: {},
    fortifications: {},
    besieged: [],
    destroyed_forts: [],
    activations: {},
    decks: { ap: [], cp: [] },
    hands: { ap: [], cp: [] },
    discard: { ap: [], cp: [] },
    removed: { ap: [], cp: [] },
    card_owners: {},
    commitment: { ap: "mobilization", cp: "mobilization" },
    war_status: { ap: 0, cp: 0, combined: 0 },
    rp: {
      ap: { br: 0, fr: 0, it: 0, us: 0 },
      cp: { ge: 0, ah: 0, east: 0 },
    },
    mo: {
      current: {},
      completed: {},
      progress: {},
      drm_used: {},
      targets: {},
      order: [],
      index: 0,
      pool: {},
      draw_bonus: {},
      draw_count: {},
      draw_limit: {},
      completion_required: {},
      bag: {},
      drawn: {},
      review: { confirmed: [] },
      revealed: [],
      history: [],
      waived: {},
      penalized: {},
      front_commitments: {},
    },
    naval: {
      track: 0,
      selections: {},
      points: { ap: 0, cp: 0 },
      event_queue: [],
      resolving: false,
      pending_fleet_cards: {},
      dispositions: {},
      disposition_order: [],
    },
    fronts: { russian: 0, turkish: 0 },
    front_storage: { russian: 0, turkish: 0 },
    events: {},
    event_history: [],
    scheduled_events: [],
    pending_event: null,
    turn_flags: {},
    usage_limits: {},
    entry_tracks: { us: 0, armistice: 0 },
    campaign_flags: { paris_attacked: false },
    combat_modifiers: {},
    permanently_removed_units: [],
    eliminated: { ap: [], cp: [] },
    markers: {},
    vp: 10,
    ops: null,
    sr: null,
    combat: null,
    pending_replacement: null,
    hq_turn_track: { ap: [], cp: [] },
    pending_retreat: null,
    replacement_active: null,
    result: null,
    victory: null,
    next_unit_id: 1000,
    combat_window: null,
    post_combat_window: null,
    retained_combat_cards: { ap: [], cp: [] },
    pending_combat_card_disposition: null,
    draw_discard: null,
    voluntary_cleanup: null,
  };
}

const FORT_LOSS = "__fort__";

const AUXILIARY_FLOW_STATES = new Set([
  "defense_mo",
  "naval_disposition",
  "flag_supply_warnings",
  "review_supply_warnings",
  "review_rollback_proposal",
  "confirm_rollback",
  "game_over",
]);

const Engine = createEngine({
  data,
  constants: {
    AP,
    AP_ROLE,
    CP,
    CP_ROLE,
    HISTORICAL,
    MO_NATIONS,
    NONE,
  },
  indexes: { cardById, cardSpecById, moById, pieceById, spaceById },
  core: { clone, factionRole, findUnit, other, roleFaction, unique },
  adapters: {
    checkpoint,
    clearUndo,
    rollbackSnapshot,
    setRollbackSnapshots,
    log,
    random,
    restoreSnapshot,
    roll,
    shuffle,
    snapshot,
  },
  extras: {
    ActionProtocol,
    AUXILIARY_FLOW_STATES,
    ConnectionData,
    FORT_LOSS,
    ViewExplanations,
    ensureState,
    enterEventFlow,
    spaceName: (id) => spaceById[id]?.name || id,
    undoAvailable,
  },
  systems: {
    cardZones: CardZones,
  },
  systemFactories: {
    map: createMapSystem,
    fronts: createFrontSystem,
    units: createUnitSystem,
    replacement: createReplacementSystem,
    operations: createOperationsSystem,
    combatCards: createCombatCardSystem,
    mo: createMoSystem,
    combat: createCombatSystem,
    supply: createSupplySystem,
    naval: createNavalSystem,
    turn: createTurnSystem,
    action: createActionSystem,
    events: createEventSystem,
    view: createViewSystem,
    deterministic: createDeterministicSystem,
  },
  stateFactories: [
    createActionStates,
    createActivationStates,
    createMovementStates,
    createCombatStates,
    createTurnStates,
    createEventStates,
  ],
});

const {
  actionAllowed,
  activationCost,
  activationSelectionSpec,
  adjustVp,
  applyCombatOutcomeEffects,
  applyEndTurnVp,
  applyFrontEndTurnEffects,
  applyMoModification,
  applyRecurringReinforcements,
  applyWarStatusEntryTracks,
  attackQualifiesForMo,
  attacksTarget,
  beginCombat,
  beginDrawPhase,
  beginFrontEndSr,
  beginFrontMaintenance,
  beginFrontMoCommitmentReview,
  beginHindenburgLineEvent,
  beginMoPenaltyResolution,
  beginReplacement,
  beginRollbackProposal,
  beginScheduledReturns,
  beginSupplyWarningEditor,
  beginVoluntaryCleanup,
  buildActionView,
  canBesiege,
  captureSpace,
  cardIds,
  cardZoneInventory,
  assertCardConservation,
  checkVictory,
  chooseFrontInvestment,
  chooseFrontMaintenance,
  commitFrontMo,
  clampVp,
  clearCombatEvents,
  combatCardsView,
  combatCardLegal,
  postCombatCardLegal,
  revealCommittedCombatCards,
  combatModifiers,
  diazHqSpaces,
  combatRepairCandidates,
  combatReplacementOptions,
  replacementKeys,
  combatStrength,
  combatWinner,
  computeMoMarkerOrigins,
  connectionAllows,
  connectionBetween,
  connectionRule,
  defenseMoChoices,
  destroyFort,
  drawMo,
  drawMoForNation,
  eliminateUnit,
  eventLegal,
  entryGapVpCost,
  finalTerritoryVp,
  finishCombatSequence,
  finishCombatLosses,
  finishReplacement,
  fireResult,
  frontInvestmentPaymentChoices,
  frontInvestmentSpec,
  frontMaintenanceEventChoices,
  frontMoCommitmentCandidates,
  frontMoCommitmentPlan,
  frontMoLossCandidates,
  frontMoObligation,
  frontMoReservedRp,
  gameOver,
  hqEndLegal,
  hqReturnSpaces,
  intactFort,
  isCombatUnit,
  italianTheaterActive,
  landNeighbors,
  markMoForAttack,
  markMoRequirement,
  moAttackEffect,
  moAttackMatches,
  moAvailable,
  moBagDefinitions,
  moDefinition,
  moPenaltyAttackOptions,
  moPenaltyLossCandidates,
  moPenaltyLossValue,
  moveFront,
  movementDestinations,
  movementPaths,
  movementRoutes,
  regionActivationBatchForUnit,
  multinationalAttackValid,
  movementStepDestinations,
  canOccupyByEarlyWarDepth,
  earlyWarOccupationLimit,
  occupationDepth,
  occupationDepths,
  schlieffenOverstackCandidates,
  neighborsFor,
  nextFactionAction,
  optionalCombatEventChoices,
  overlandSrSpaces,
  passiveMoModifiers,
  populateVeteranUpgradePool,
  prepareCombatCardDispositions,
  reduceCombatUnit,
  refreshBesiegedSpace,
  reserveSrDestinations,
  resolveAttrition,
  resolveCombat,
  resolveCombatCardDisposition,
  resolveFactionAttrition,
  resolveFortCombatLoss,
  resolveSieges,
  resolveWarStatus,
  retreatDestinations,
  ruleModifier,
  setupDeck,
  srDestinations,
  stackLegal,
  suppliedSpaces,
  theaterOf,
  turkishFrontActive,
  unfulfilledMoObligations,
  unitIsActivated,
  updateSupply,
  validateAttackDeclaration,
  validateMovementPath,
  voluntaryCleanupOptions,
} = Engine;

exports.action = function (state, current, action, arg) {
  ensureState(state);
  advanceRestoringState(state);
  if (!state || state.state === "game_over") return state;
  if (!actionAllowed(state, current)) return state;
  const offered = buildActionView(clone(state), current);
  const primitiveArg = arg === null ? undefined : arg;
  if (!ActionProtocol.allows(offered.actions, action, primitiveArg))
    return state;
  const stateBefore = state.state;
  const activeBefore = state.active;
  const seedBefore = state.seed;
  const before = clone(state);
  undoActionContext = {
    state,
    before,
    entry: null,
    snapshotTaken: false,
    deterministic: false,
  };
  try {
    if (action === "undo") {
      undoActionContext.suppress = true;
      if (!undoAvailable(state))
        throw new Error("Undo point is no longer available");
      const entry = state.undo.pop();
      restoreSnapshot(state, entry);
      ensureState(state);
    } else if (action === "propose_rollback") {
      undoActionContext.suppress = true;
      beginRollbackProposal(state, arg);
      clearUndo(state);
    } else if (action === "flag_supply_warnings") {
      undoActionContext.suppress = true;
      beginSupplyWarningEditor(state);
    } else if (!Engine.dispatch(state, action, arg, current)) {
      throw new Error("Offered action has no state handler");
    }
    undoActionContext.deterministic = true;
    Engine.advanceDeterministicStates(state);
    undoActionContext.deterministic = false;
    if (state.state !== "game_over")
      checkVictory(state, { armisticeOnly: true });
    if (!Engine.hasState(state.state))
      throw new Error(`Unregistered stable state: ${state.state}`);
    const changedPlayer =
      [AP, CP].includes(activeBefore) &&
      [AP, CP].includes(state.active) &&
      activeBefore !== state.active;
    if (changedPlayer || state.seed !== seedBefore) clearUndo(state);
    if (AUTO_CARD_CONSERVATION || state.options?.assert_card_conservation)
      assertCardConservation(state);
  } catch (error) {
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, before);
    const detail = `${stateBefore}/${action}/${String(primitiveArg)}`;
    const wrapped = new Error(`Action failed (${detail}): ${error.message}`);
    wrapped.cause = error;
    throw wrapped;
  } finally {
    undoActionContext = null;
  }
  return state;
};
exports.view = function (state, current) {
  ensureState(state);
  advanceRestoringState(state);
  return Engine.view(state, current);
};

exports.query = function (state, current, query) {
  ensureState(state);
  const faction = roleFaction(current);
  if (query === "cards")
    return faction ? state.hands[faction].map((id) => cardById[id]) : [];
  if (query === "ap_cards")
    return faction === AP ? state.hands.ap.map((id) => cardById[id]) : [];
  if (query === "cp_cards")
    return faction === CP ? state.hands.cp.map((id) => cardById[id]) : [];
  if (query === "supply") {
    updateSupply(state);
    return {
      ap: [...suppliedSpaces(state, AP)],
      cp: [...suppliedSpaces(state, CP)],
      units: Object.fromEntries(
        state.units.map((unit) => [
          unit.id,
          ViewExplanations.supplyStatus(unit),
        ]),
      ),
    };
  }
  if (query === "combat_preview") return clone(state.combat);
  if (query === "rollback")
    return ViewExplanations.rollbackEntries(
      state,
      current,
      20,
      (index) => rollbackSnapshot(state, index),
    );
  return null;
};

exports.resign = function (state, current) {
  ensureState(state);
  if (state.state === "game_over") return state;
  const faction = roleFaction(current);
  if (!faction) return state;
  gameOver(state, other(faction), `${factionRole(faction)} 认输。`);
  return state;
};

exports.setup = function (seed, scenario = HISTORICAL, options = {}) {
  if (scenario !== HISTORICAL)
    throw new Error(`Unsupported public scenario: ${scenario}`);
  const state = createState(seed, options);
  setupDeck(state, AP);
  setupDeck(state, CP);
  updateSupply(state);
  return state;
};

exports.analysis = Engine.registerAnalysis(
  createAnalysis({
    clone,
    view: (state, role) => exports.view(state, role),
    action: (state, role, action, arg) =>
      exports.action(state, role, action, arg),
    allows: ActionProtocol.allows,
    movementAllowance: (unit) => pieceById[unit?.piece]?.movement || 0,
    srTransport(state, id, destination) {
      const unit =
        state.units?.find((candidate) => candidate.id === id) ||
        state.reserves?.[state.active]?.find(
          (candidate) => candidate.id === id,
        );
      if (!unit?.location || destination === "reserve") return "reserve";
      if (overlandSrSpaces(state, unit).has(destination)) return "land";
      if (theaterOf(unit.location) !== theaterOf(destination))
        return "theater_boundary";
      return "supply_network";
    },
  }),
);

exports._test = {
  advanceDeterministicStates: Engine.advanceDeterministicStates,
  checkpoint,
  clearUndo,
  decodeRollbackStates,
  engineStateNames: Engine.stateNames,
  encodeRollbackStates,
  restoreSnapshot,
  rollbackSnapshot,
  snapshot,
  assertCardConservation,
  cardZoneInventory,
  clampVp,
  adjustVp,
  connectionBetween,
  connectionRule,
  connectionAllows,
  neighborsFor,
  landNeighbors,
  random,
  shuffle,
  drawMo,
  drawMoForNation,
  moBagDefinitions,
  turkishFrontActive,
  fireResult,
  suppliedSpaces,
  updateSupply,
  resolveAttrition,
  resolveFactionAttrition,
  nextFactionAction,
  activationCost,
  activationSelectionSpec,
  unitIsActivated,
  stackLegal,
  movementPaths,
  movementDestinations,
  movementStepDestinations,
  canOccupyByEarlyWarDepth,
  earlyWarOccupationLimit,
  occupationDepth,
  occupationDepths,
  schlieffenOverstackCandidates,
  validateMovementPath,
  srDestinations,
  reserveSrDestinations,
  attacksTarget,
  validateAttackDeclaration,
  beginCombat,
  retreatDestinations,
  combatStrength,
  combatModifiers,
  diazHqSpaces,
  resolveCombat,
  resolveSieges,
  resolveFortCombatLoss,
  eliminateUnit,
  refreshBesiegedSpace,
  destroyFort,
  captureSpace,
  eventLegal,
  entryGapVpCost,
  intactFort,
  multinationalAttackValid,
  optionalCombatEventChoices,
  canBesiege,
  applyCombatOutcomeEffects,
  combatWinner,
  prepareCombatCardDispositions,
  resolveCombatCardDisposition,
  combatCardsView,
  combatCardLegal,
  postCombatCardLegal,
  revealCommittedCombatCards,
  finishCombatSequence,
  finishCombatLosses,
  clearCombatEvents,
  markMoForAttack,
  attackQualifiesForMo,
  computeMoMarkerOrigins,
  defenseMoChoices,
  markMoRequirement,
  moAttackMatches,
  moAttackEffect,
  passiveMoModifiers,
  unfulfilledMoObligations,
  beginMoPenaltyResolution,
  moPenaltyAttackOptions,
  moPenaltyLossCandidates,
  moPenaltyLossValue,
  applyEndTurnVp,
  finalTerritoryVp,
  checkVictory,
  applyWarStatusEntryTracks,
  applyFrontEndTurnEffects,
  beginFrontEndSr,
  resolveWarStatus,
  applyRecurringReinforcements,
  populateVeteranUpgradePool,
  moveFront,
  beginFrontMaintenance,
  beginFrontMoCommitmentReview,
  frontMaintenanceEventChoices,
  chooseFrontMaintenance,
  commitFrontMo,
  frontInvestmentSpec,
  frontMoCommitmentCandidates,
  frontMoCommitmentPlan,
  frontMoObligation,
  frontMoReservedRp,
  frontMoLossCandidates,
  frontInvestmentPaymentChoices,
  chooseFrontInvestment,
  beginScheduledReturns,
  beginReplacement,
  finishReplacement,
  beginDrawPhase,
  beginVoluntaryCleanup,
  voluntaryCleanupOptions,
  hqEndLegal,
  hqReturnSpaces,
  combatReplacementOptions,
  replacementKeys,
  reduceCombatUnit,
  cardIds,
};
