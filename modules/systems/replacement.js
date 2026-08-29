"use strict";

// Printed LCU -> SCU priority. Entries in one nested array are equivalent.
const ARMY_REPLACEMENT_PRIORITY = Object.freeze({
  "component-016": [["component-015"], ["component-019"]],
  "component-017": [["component-019"], ["component-015"]],
  "component-021": [["component-014"]],
  "component-022": [["component-023"], ["component-024"]],
  "component-026": [["component-028"], ["component-031"]],
  "component-030": [["component-032"], ["component-028"], ["component-031"]],
  "component-033": [["component-034"]],
  "component-037": [["component-038"], ["component-034"]],
  "component-039": [["component-048"], ["component-034"]],
  "component-041": [["component-042"], ["component-034"]],
  "component-045": [["component-047"], ["component-034"], ["component-046"]],
  "component-091": [["component-092"], ["component-094"], ["component-089"], ["component-100"], ["component-095"], ["component-090"], ["component-101"]],
  "component-093": [["component-094"], ["component-089"], ["component-100"], ["component-095"], ["component-090"], ["component-101"]],
  "component-097": [["component-098"], ["component-094"], ["component-089"], ["component-095"]],
  "component-099": [["component-100"], ["component-101"]],
  "component-102": [["component-103"]],
  "component-105": [["component-104"], ["component-028"], ["component-031"]],
  "component-108": [["component-107"], ["component-034"]],
  "component-110": [["component-109"], ["component-107"]],
  "component-166": [["component-107"], ["component-014", "component-034"]],
  "component-167": [["component-107"], ["component-014", "component-034"]],
  "component-169": [["component-028"], ["component-031"]],
  "component-170": [["component-094"], ["component-089"], ["component-100"], ["component-095"], ["component-090"], ["component-101"]],
});

function createReplacementSystem(api) {
  const { pieceById } = api;
  function replacementOptionsFromPool(pool, army) {
    const priorities = ARMY_REPLACEMENT_PRIORITY[army.piece] || [];
    let candidates = [];
    for (const pieces of priorities) {
      candidates = pool.filter((unit) => {
        const piece = pieceById[unit.piece];
        return (unit.type || piece?.type) === "corps" &&
          pieces.includes(unit.piece) && !piece?.mountain;
      });
      if (candidates.length) break;
    }
    if (!candidates.length) return [];
    const preferred = candidates.some((unit) => !unit.reduced)
      ? candidates.filter((unit) => !unit.reduced)
      : candidates.filter((unit) => unit.reduced);
    const seen = new Set();
    return preferred.filter((unit) => {
      const key = `${unit.piece}:${unit.reduced ? 1 : 0}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function combatReplacementOptions(state, army) {
    return replacementOptionsFromPool(state.reserves[army.faction], army);
  }

  

  function beginReplacement(state) {
      state.phase = "补员/升级";
      state.state = "replacement";
      api.setActiveFaction(state, api.AP);
      state.replacement_active = api.AP;
      if (api.beginHqReturns(state))
          return;
      continueReplacement(state);
  }

  function continueReplacement(state) {
      state.phase = "补员/升级";
      state.state = "replacement";
      api.setActiveFaction(state, api.AP);
      state.replacement_active = api.AP;
      if (api.applyRecurringReinforcements(state))
          return;
      const incomeKey = `replacement_income:${state.turn}`;
      if (!state.usage_limits[incomeKey]) {
          for (const [event, status] of Object.entries(state.events)) {
              const bonus = status?.replacement_bonus || api.data.events[event]?.replacement_bonus;
              if (!status || !bonus)
                  continue;
              for (const [nation, amount] of Object.entries(bonus))
                  state.rp[status.faction][nation] =
                      (state.rp[status.faction][nation] || 0) + amount;
          }
          const italy = api.activeRule(state, "italy_entry");
          if (italy?.total_war_rp && state.commitment.ap === "total") {
              const bonus = italy.total_war_rp;
              const usageKey = `italy_entry_rp:${state.turn}`;
              if (!state.usage_limits[usageKey]) {
                  state.rp[bonus.faction][bonus.nation] += bonus.amount;
                  state.usage_limits[usageKey] = 1;
              }
          }
          for (const [event, status] of Object.entries(state.events)) {
              const loss = status?.recurring_rp_loss || api.data.events[event]?.recurring_rp_loss;
              if (!status || !loss)
                  continue;
              for (const [faction, nations] of Object.entries(loss))
                  for (const [nation, amount] of Object.entries(nations)) {
                      const reserved = api.frontMoReservedRp(state, faction, nation);
                      const spendable = Math.max(0, (state.rp[faction][nation] || 0) - reserved);
                      state.rp[faction][nation] -= Math.min(amount, spendable);
                  }
          }
          state.usage_limits[incomeKey] = 1;
          if (beginKillingGroundMaintenance(state))
              return;
      }
      if (api.beginFrontMaintenance(state))
          return;
      api.log(state, "协约国补员、升级与战线投入。");
  }

  function beginKillingGroundMaintenance(state) {
      const marker = state.markers.killing_ground;
      if (!marker)
          return false;
      const usageKey = `killing_ground_maintenance:${state.turn}`;
      if (state.usage_limits[usageKey])
          return false;
      state.pending_event = {
          kind: "killing_ground_maintenance",
          card: marker.source_card || 720,
          owner: api.CP,
          chooser: api.CP,
          cost: marker.cost,
          usage_key: usageKey,
      };
      api.setActiveFaction(state, api.CP);
      api.enterEventFlow(state);
      return true;
  }

  function resolveKillingGroundMaintenance(state, choice) {
      const pending = state.pending_event;
      const marker = state.markers.killing_ground;
      if (pending?.kind !== "killing_ground_maintenance" || !marker)
          throw new Error("No Killing Ground maintenance is pending");
      if (choice === "maintain") {
          if (state.rp.cp.ge < pending.cost)
              throw new Error("Insufficient GE RP to maintain Killing Ground");
          state.rp.cp.ge -= pending.cost;
          marker.cost = pending.cost + 1;
      }
      else if (choice === "abandon") {
          api.permanentlyRemovePiece(state, "component-004", pending.card);
          delete state.events[api.cardById[pending.card].event];
          delete state.markers.killing_ground;
      }
      else
          throw new Error("Invalid Killing Ground maintenance choice");
      state.usage_limits[pending.usage_key] = 1;
      state.pending_event = null;
      continueReplacement(state);
  }

  function finishReplacement(state) {
      api.completeSatisfiedFrontMos(state, state.active);
      let obligation = api.frontMoObligation(state, state.active);
      if (obligation) {
          const spec = api.frontInvestmentSpec(state, obligation.front, state.active);
          const impossible = (!spec || api.frontInvestmentAvailable(state, spec) < spec.cost - 1e-9) &&
              api.frontMoLossCandidates(state, state.active).length === 0;
          if (!impossible)
              throw new Error(`${obligation.nation.toUpperCase()} MO requires advancing the ${obligation.front} front`);
          api.resolveNonTaskMo(state, obligation.nation, obligation.id, "exhausted");
          obligation = null;
      }
      if (state.active === api.AP) {
          api.setActiveFaction(state, api.CP);
          state.replacement_active = api.CP;
          api.log(state, "同盟国补员、升级与战线投入。");
      }
      else {
          if (!api.beginBulgariaFrontResponse(state))
              finishPostReplacement(state);
      }
  }

  function finishPostReplacement(state) {
      for (const faction of [api.AP, api.CP])
          for (const nation of Object.keys(state.rp[faction]))
              state.rp[faction][nation] = 0;
      api.applyFrontEndTurnEffects(state);
      if (api.beginFrontEndSr(state))
          return;
      api.beginDrawPhase(state);
  }

  function veteranUpgradeNation(unit) {
      return unit.nation;
  }

  function veteranUpgradeOption(
      state,
      id,
      faction = state.active,
      requestedKey = null,
      formalReplacement = state.state === "replacement",
  ) {
      if (state.commitment[faction] === "mobilization")
          return null;
      const mapUnit = state.units.find((candidate) => candidate.id === id && candidate.faction === faction);
      const eliminatedUnit = state.eliminated[faction].find((candidate) => candidate.id === id);
      const unit = mapUnit || eliminatedUnit;
      if (!unit ||
          !api.acceptsReplacementPoints(unit) ||
          (mapUnit && (unit.supplied === false || unit.fort_limited_supply)) ||
          api.pieceById[unit.piece]?.veteran ||
          ["component-089", "component-090"].includes(unit.piece))
          return null;
      const nation = veteranUpgradeNation(unit);
      const tokenIndex = state.upgrade_pool[faction].findIndex((token) => {
          const veteran = api.pieceById[token.piece];
          return (veteran?.veteran &&
              !veteran.combined_nations &&
              veteran.nation === nation &&
              veteran.type === unit.type);
      });
      if (tokenIndex < 0)
          return null;
      const usageKey = formalReplacement
          ? `veteran_upgrade:${state.turn}:${nation}:${unit.type}`
          : null;
      let freeCount = formalReplacement ? 1 : 0;
      if (formalReplacement)
          for (const status of Object.values(state.events)) {
              const free = status?.free_upgrade;
              if (free?.nation === nation && free.type === unit.type)
                  freeCount += free.count;
          }
      const used = usageKey ? state.usage_limits[usageKey] || 0 : 0;
      const cost = used < freeCount ? 0 : unit.type === "army" ? 1 : 0.5;
      const keys = replacementKeys(unit).filter((key) => (state.rp[faction][key] || 0) >= cost);
      const key = requestedKey
          ? keys.includes(requestedKey)
              ? requestedKey
              : null
          : keys[0];
      if (!key)
          return null;
      return {
          kind: "upgrade",
          unit,
          zone: mapUnit ? "map" : "eliminated",
          key,
          cost,
          tokenIndex,
          token: state.upgrade_pool[faction][tokenIndex],
          usageKey,
          used,
      };
  }

  function veteranUpgradeCurrentOption(state, pending = state.pending_event) {
      if (pending?.kind !== "veteran_upgrade") return null;
      return veteranUpgradeOption(
          state,
          pending.unit,
          pending.faction,
          pending.key,
          Boolean(pending.formal_replacement),
      );
  }

  function veteranUpgradeRestrictionTheater(option) {
      if (!option || !["army", "hq"].includes(option.unit.type)) return null;
      return api.cardSpecById[option.unit.reinforcement_card]?.operations?.find((operation) =>
          operation.type === "reinforcement" &&
          operation.restriction_scope === "generated_army_hq")?.rebuild_theater || null;
  }

  function veteranUpgradeSpaces(state, pending = state.pending_event) {
      const option = veteranUpgradeCurrentOption(state, pending);
      if (!option || option.zone !== "map") return [];
      const source = option.unit.location;
      const theater = veteranUpgradeRestrictionTheater(option);
      const candidate = { ...option.unit, piece: option.token.piece };
      const sources = api.supplySources(state, pending.faction, option.unit.nation);
      const spaces = new Set(source ? [source] : []);
      for (const space of sources)
          if (state.control[space] === pending.faction &&
              !api.unitsAt(state, space, api.other(pending.faction)).length &&
              (!theater || api.theaterOf(space) === theater) &&
              (space === source || api.stackLegal(state, space, candidate)))
              spaces.add(space);
      return [...spaces];
  }

  function veteranUpgradeReserveAllowed(state, pending = state.pending_event) {
      const option = veteranUpgradeCurrentOption(state, pending);
      return Boolean(option && option.unit.type === "corps");
  }

  function veteranUpgradeEliminatedAllowed(state, pending = state.pending_event) {
      const option = veteranUpgradeCurrentOption(state, pending);
      return Boolean(option && option.zone === "eliminated");
  }

  function beginVeteranUpgrade(state, option) {
      state.pending_event = {
          kind: "veteran_upgrade",
          owner: state.active,
          faction: state.active,
          unit: option.unit.id,
          source_zone: option.zone,
          source_space: option.unit.location || null,
          key: option.key,
          formal_replacement: Boolean(option.usageKey),
          resume_state: state.state,
          resume_phase: state.phase,
      };
      state.phase = "老兵替换";
      api.enterEventFlow(state);
  }

  function commitVeteranUpgrade(state, destination) {
      const pending = state.pending_event;
      if (pending?.kind !== "veteran_upgrade")
          throw new Error("No veteran upgrade is pending");
      const option = veteranUpgradeCurrentOption(state, pending);
      const toReserve = destination === "reserve";
      const toEliminated = destination === "eliminated";
      const spaces = veteranUpgradeSpaces(state, pending);
      if (!option ||
          (toReserve ? !veteranUpgradeReserveAllowed(state, pending) :
              toEliminated ? !veteranUpgradeEliminatedAllowed(state, pending) :
                  !spaces.includes(destination)))
          throw new Error("Illegal veteran placement");
      const sourcePool = pending.source_zone === "map"
          ? state.units
          : state.eliminated[pending.faction];
      const sourceIndex = sourcePool.findIndex((unit) => unit.id === pending.unit);
      const tokenIndex = state.upgrade_pool[pending.faction].findIndex((token) => token.id === option.token.id);
      if (sourceIndex < 0 || tokenIndex < 0)
          throw new Error("Veteran replacement is no longer available");
      if ((state.rp[pending.faction][option.key] || 0) < option.cost)
          throw new Error("Veteran replacement RP is no longer available");
      const [source] = sourcePool.splice(sourceIndex, 1);
      const [token] = state.upgrade_pool[pending.faction].splice(tokenIndex, 1);
      state.rp[pending.faction][option.key] -= option.cost;
      if (option.usageKey)
          state.usage_limits[option.usageKey] =
              (state.usage_limits[option.usageKey] || 0) + 1;
      const removedRookie = {
          ...api.clone(source),
          id: token.id,
          removed_by: "veteran_upgrade",
          removed_turn: state.turn,
      };
      api.normalizeOffMapUnit(removedRookie);
      state.permanently_removed_units.push(removedRookie);
      const veteran = {
          ...source,
          piece: token.piece,
          reduced: Boolean(source.reduced),
          moved: false,
          attacked: false,
      };
      if (toEliminated) {
          api.normalizeOffMapUnit(veteran);
          state.eliminated[pending.faction].push(veteran);
      }
      else if (toReserve) {
          api.normalizeOffMapUnit(veteran);
          state.reserves[pending.faction].push(veteran);
      }
      else {
          veteran.location = destination;
          veteran.supplied = true;
          veteran.fort_limited_supply = false;
          state.units.push(veteran);
      }
      if (pending.resume_immediate_rp || pending.resume_combat_fr_rp) {
          const resume = pending.resume_immediate_rp || pending.resume_combat_fr_rp;
          if (pending.resume_combat_fr_rp)
              resume.remaining = Math.max(0, resume.remaining - pending.immediate_rp_cost);
          else
              resume.remaining[pending.immediate_rp_key] = Math.max(0, (resume.remaining[pending.immediate_rp_key] || 0) -
                  pending.immediate_rp_cost);
          state.pending_event = resume;
          state.phase = "行动阶段";
          api.enterEventFlow(state);
      }
      else {
          state.pending_event = null;
          state.phase = pending.resume_phase || "补员/升级";
          state.state = pending.resume_state || "replacement";
      }
      api.updateSupply(state);
  }

  function replacementOption(state, arg) {
      arg ||= {};
      const faction = arg.faction || state.active;
      const unit = state.units.find((candidate) => candidate.id === arg.unit && candidate.faction === faction);
      if (arg.kind === "flip") {
          if (!unit?.reduced || unit.supplied === false || unit.fort_limited_supply || !api.acceptsReplacementPoints(unit))
              return null;
          if (api.activeRule(state, "victory_or_collapse") &&
              state.fronts.turkish >= 9 &&
              unit.nation === "ah")
              return null;
          const cost = api.unitRepairCost(unit);
          const keys = replacementKeys(unit).filter((key) => (state.rp[faction][key] || 0) >= cost);
          const key = arg.key ? (keys.includes(arg.key) ? arg.key : null) : keys[0];
          if (!key)
              return null;
          return { kind: "flip", unit, key, cost };
      }
      if (arg.kind === "upgrade") {
          return veteranUpgradeOption(state, arg.unit, faction, arg.key);
      }
      if (arg.kind === "rebuild") {
          const eliminated = state.eliminated?.[faction] || [];
          const index = eliminated.findIndex((candidate) => candidate.id === arg.unit);
          if (index < 0)
              return null;
          const candidate = eliminated[index];
          if (!api.acceptsReplacementPoints(candidate) || api.permanentOnElimination(candidate))
              return null;
          const collapse = api.activeRule(state, "victory_or_collapse");
          let rebuildUsageKey = null;
          if (collapse && state.fronts.turkish >= 9 && candidate.nation === "ah")
              return null;
          if (collapse && candidate.nation !== "us") {
              const category = candidate.type === "army" ? "army" : "corps";
              const limit = candidate.nation === "ge"
                  ? category === "army"
                      ? collapse.rebuild_limits.ge[0]
                      : collapse.rebuild_limits.ge[1]
                  : category === "army"
                      ? collapse.rebuild_limits.ap[0]
                      : collapse.rebuild_limits.ap[1];
              const usageKey = `rebuild:${state.turn}:${candidate.nation}:${category}`;
              if ((state.usage_limits[usageKey] || 0) >= limit)
                  return null;
              rebuildUsageKey = usageKey;
          }
          const cost = Math.max(1, api.unitRepairCost(candidate));
          const keys = replacementKeys(candidate).filter((key) => (state.rp[faction][key] || 0) >= cost);
          const key = arg.key ? (keys.includes(arg.key) ? arg.key : null) : keys[0];
          if (!key)
              return null;
          const restrictedRebuild = api.cardSpecById[candidate.reinforcement_card]?.operations?.find((operation) =>
              operation.type === "reinforcement" &&
              operation.restriction_scope === "generated_army_hq");
          const rebuildTheater = ["army", "hq"].includes(candidate.type)
              ? restrictedRebuild?.rebuild_theater
              : null;
          // French armies rebuild only at their three printed mainland supply
          // sources.  Other units use their own national supply sources; never
          // fall back to the first source belonging to the whole faction.
          const sourceIds = candidate.nation === "fr" && candidate.type === "army"
              ? ["paris", "orleans", "chaumont"]
              : api.supplySources(state, faction, candidate.nation);
          const spaces = new Set();
          for (const sourceId of sourceIds) {
              if (state.control[sourceId] !== faction ||
                  api.unitsAt(state, sourceId, api.other(faction)).length ||
                  (rebuildTheater && api.theaterOf(sourceId) !== rebuildTheater))
                  continue;
              if (api.stackLegal(state, sourceId, candidate)) {
                  spaces.add(sourceId);
                  continue;
              }
              // A full printed supply source may overflow into an adjacent
              // friendly legal space. Ports are explicitly excluded.
              if (api.spaceById[sourceId]?.port) continue;
              for (const adjacent of api.landNeighbors(sourceId))
                  if (state.control[adjacent] === faction &&
                      !api.unitsAt(state, adjacent, api.other(faction)).length &&
                      (!rebuildTheater || api.theaterOf(adjacent) === rebuildTheater) &&
                      api.stackLegal(state, adjacent, candidate))
                      spaces.add(adjacent);
          }
          if (!spaces.size && candidate.type !== "corps")
              return null;
          return {
              kind: "rebuild",
              unit: candidate,
              key,
              cost,
              eliminated,
              index,
              spaces: [...spaces],
              rebuildUsageKey,
              reserveAllowed: candidate.type === "corps",
          };
      }
      if (arg.kind === "front") {
          const track = arg.track === "russian"
              ? "russian"
              : arg.track === "turkish"
                  ? "turkish"
                  : null;
          if (!track)
              return null;
          if (api.frontMovementLocked(state, track))
              return null;
          const spec = api.frontInvestmentSpec(state, track, faction);
          if (!spec)
              return null;
          const available = api.frontInvestmentAvailable(state, spec);
          const storage = state.front_storage[track] || 0;
          if (available <= 0 || (available < spec.cost && storage >= 1 - 1e-9))
              return null;
          if (spec.mo && !api.frontInvestmentCanComplete(state, spec))
              return null;
          if (spec.allow_unit_payment && !api.frontInvestmentCanComplete(state, spec))
              return null;
          return { kind: "front", ...spec };
      }
      return null;
  }

  function spendReplacement(state, arg) {
      const option = replacementOption(state, arg);
      if (!option)
          throw new Error("Illegal replacement action");
      if (option.kind === "flip") {
          const { unit, key, cost } = option;
          state.rp[state.active][key] -= cost;
          unit.reduced = false;
          return;
      }
      if (option.kind === "upgrade") {
          beginVeteranUpgrade(state, option);
          return;
      }
      if (option.kind === "rebuild") {
          const current = state.pending_event;
          state.pending_event = {
              kind: "replacement_rebuild",
              ...(current?.card != null ? { card: current.card } : {}),
              owner: state.active,
              chooser: state.active,
              faction: state.active,
              unit: option.unit.id,
              key: option.key,
              cost: option.cost,
              resume_state: state.state,
              resume_phase: state.phase,
          };
          api.enterEventFlow(state);
          return;
      }
      if (option.kind === "front") {
          api.beginFrontInvestment(state, option);
          return;
      }
  }

  function replacementRebuildSpaces(state, pending = state.pending_event) {
      if (pending?.kind !== "replacement_rebuild")
          return [];
      const option = replacementOption(state, {
          kind: "rebuild",
          unit: pending.unit,
          key: pending.key,
          faction: pending.faction,
      });
      return option?.spaces || [];
  }

  function replacementRebuildReserveAllowed(state, pending = state.pending_event) {
      if (pending?.kind !== "replacement_rebuild") return false;
      return Boolean(replacementOption(state, {
          kind: "rebuild",
          unit: pending.unit,
          key: pending.key,
          faction: pending.faction,
      })?.reserveAllowed);
  }

  function commitReplacementRebuild(state, destination) {
      const pending = state.pending_event;
      if (pending?.kind !== "replacement_rebuild")
          throw new Error("No replacement rebuild placement is pending");
      const option = replacementOption(state, {
          kind: "rebuild",
          unit: pending.unit,
          key: pending.key,
          faction: pending.faction,
      });
      const toReserve = destination === "reserve";
      if (!option || (toReserve ? !option.reserveAllowed : !option.spaces.includes(destination)))
          throw new Error("Illegal replacement rebuild destination");
      const { unit, key, cost, eliminated, rebuildUsageKey } = option;
      const index = eliminated.findIndex((candidate) => candidate.id === unit.id);
      if (index < 0)
          throw new Error("Replacement unit is no longer eliminated");
      state.rp[pending.faction][key] -= cost;
      unit.reduced = true;
      unit.moved = false;
      unit.attacked = false;
      eliminated.splice(index, 1);
      if (toReserve) {
          api.normalizeOffMapUnit(unit);
          state.reserves[pending.faction].push(unit);
      }
      else {
          unit.location = destination;
          unit.supplied = true;
          unit.fort_limited_supply = false;
          state.units.push(unit);
      }
      if (rebuildUsageKey)
          state.usage_limits[rebuildUsageKey] =
              (state.usage_limits[rebuildUsageKey] || 0) + 1;

      if (pending.resume_immediate_rp || pending.resume_combat_fr_rp) {
          const resume = pending.resume_immediate_rp || pending.resume_combat_fr_rp;
          if (pending.resume_combat_fr_rp)
              resume.remaining = Math.max(0, resume.remaining - pending.immediate_rp_cost);
          else
              resume.remaining[pending.immediate_rp_key] = Math.max(
                  0,
                  (resume.remaining[pending.immediate_rp_key] || 0) - pending.immediate_rp_cost,
              );
          state.pending_event = resume;
          state.phase = "行动阶段";
          api.enterEventFlow(state);
      }
      else {
          state.pending_event = null;
          state.phase = pending.resume_phase || "补员/升级";
          state.state = pending.resume_state || "replacement";
      }
      api.updateSupply(state);
  }

  function replacementKeys(unit) {
      const combined = pieceById[unit.piece]?.combined_nations;
      if (unit.faction === api.CP && Array.isArray(combined) && combined.length)
          return [...new Set(combined.filter((key) => ["ge", "ah", "east"].includes(key)))];
      if (unit.faction === api.CP)
          return [unit.nation === "ah" ? "ah" : unit.nation === "ge" ? "ge" : "east"];
      if (unit.nation === "fr")
          return ["fr"];
      if (unit.nation === "it")
          return ["it"];
      if (unit.nation === "us")
          return ["us"];
      if (unit.nation === "be")
          return ["us"];
      if ([
          "component-089",
          "component-090",
          "component-099",
          "component-100",
          "component-101",
      ].includes(unit.piece))
          return ["br", "us"];
      return ["br"];
  }

  function replacementKey(unit) {
      return replacementKeys(unit)[0];
  }

  function exchangeWarAid(state, arg) {
      const warAid = api.cardById[600];
      if (state.active !== api.AP || !state.events[warAid.event])
          throw new Error("War Aid is not available");
      const routes = {
          br_to_fr: ["br", "fr"],
          fr_to_br: ["fr", "br"],
          us_to_fr: ["us", "fr"],
          fr_to_us: ["fr", "us"],
      };
      const route = routes[arg?.id];
      if (!route)
          throw new Error("Unknown War Aid exchange");
      if (route.includes("us") && !state.events.entry_us)
          throw new Error("The United States has not entered the war");
      const amount = Number(arg.amount);
      const usageKey = `war_aid:${state.turn}`;
      const used = state.usage_limits[usageKey] || 0;
      if (!Number.isInteger(amount) ||
          amount < 1 ||
          amount > 2 ||
          used + amount > 2)
          throw new Error("War Aid exchange limit exceeded");
      if ((state.rp.ap[route[0]] || 0) < amount)
          throw new Error("Insufficient RP for War Aid exchange");
      api.snapshot(state, "战争援助兑换");
      state.rp.ap[route[0]] -= amount;
      state.rp.ap[route[1]] = (state.rp.ap[route[1]] || 0) + amount;
      state.usage_limits[usageKey] = used + amount;
      api.log(state, `战争援助：${amount} ${route[0].toUpperCase()}:RP → ${route[1].toUpperCase()}:RP。`);
  }

  function eastRpConversionOptions(state) {
      if (state.state !== "replacement" || state.active !== api.CP)
          return [];
      const reserved = api.frontMoReservedRp(state, api.CP, "east");
      const available = Math.max(0, (state.rp.cp.east || 0) - reserved);
      return available >= 1 - 1e-9 ? ["ge", "ah"] : [];
  }

  function convertEastRp(state, target) {
      if (!eastRpConversionOptions(state).includes(target))
          throw new Error("No surplus EAST RP is available for conversion");
      state.rp.cp.east -= 1;
      if (target === "ge")
          state.rp.cp.ge = (state.rp.cp.ge || 0) + 1;
      else
          state.rp.cp.ah = (state.rp.cp.ah || 0) + 2;
      api.log(state, target === "ge"
          ? "补员转换：1 EAST:RP → 1 GE:RP。"
          : "补员转换：1 EAST:RP → 2 AH:RP。");
  }
return Object.freeze({
    beginKillingGroundMaintenance,
    beginReplacement,
    beginVeteranUpgrade,
    commitVeteranUpgrade,
    commitReplacementRebuild,
    combatReplacementOptions,
    continueReplacement,
    convertEastRp,
    eastRpConversionOptions,
    exchangeWarAid,
    finishPostReplacement,
    finishReplacement,
    replacementKey,
    replacementKeys,
    replacementOption,
    replacementOptionsFromPool,
    replacementRebuildReserveAllowed,
    replacementRebuildSpaces,
    resolveKillingGroundMaintenance,
    spendReplacement,
    veteranUpgradeEliminatedAllowed,
    veteranUpgradeNation,
    veteranUpgradeOption,
    veteranUpgradeReserveAllowed,
    veteranUpgradeSpaces,
  });
}

module.exports = { ARMY_REPLACEMENT_PRIORITY, createReplacementSystem };
