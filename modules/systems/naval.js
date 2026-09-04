"use strict";

function createNavalSystem(api) {
  function navalEventLegal(state, card, eventLegal) {
    return Boolean(card && card.color === "blue" && eventLegal(state, card));
  }

  function navalUseBonus(card) {
    return Number(api.cardSpecById[card?.id]?.naval_use_bonus) || 0;
  }

  function uboatMinimumActive(state, selection = null) {
    if (state.events[api.cardById[643].event]) return false;
    return Boolean(state.events[api.cardById[723].event] ||
      (selection?.kind === "event" && selection.card === 723));
  }

  function fleetPoints(state, card, track) {
    if (!card) return 0;
    return api.cardValues(state, card).ops + Math.abs(track) +
      (card.color === "blue" ? 1 : 0) + navalUseBonus(card);
  }

  

  function startNaval(state) {
      state.phase = "海军阶段";
      state.state = "naval_choice";
      api.setActiveFaction(state, api.CP);
      state.naval.selections = {};
      state.naval.event_queue = [];
      state.naval.resolving = false;
      state.naval.pending_fleet_cards = {};
      state.naval.dispositions = {};
      state.naval.disposition_order = [];
      delete state.naval.legacy_disposition_complete;
      api.log(state, "海军阶段：同盟国暗出 Event 或 Fleet。");
  }

  function finishNavalDisposition(state) {
      for (const side of [api.CP, api.AP]) {
          const card = state.naval.pending_fleet_cards[side];
          if (card == null)
              continue;
          const disposition = state.naval.dispositions[side];
          if (!disposition)
              throw new Error("Every Fleet card requires a disposition");
          if (disposition === "shuffle")
              state.decks[side] = api.shuffle(state, [...state.decks[side], card]);
          else
              state.discard[side].push(card);
      }
      state.naval.pending_fleet_cards = {};
      state.naval.dispositions = {};
      state.naval.disposition_order = [];
      delete state.naval.legacy_disposition_complete;
      state.action_round = 0;
      api.startActionRound(state);
  }

  function startNavalDisposition(state) {
      const order = [api.CP, api.AP].filter((side) => state.naval.pending_fleet_cards[side] != null);
      state.naval.disposition_order = order;
      state.naval.dispositions = {};
      if (!order.length) {
          finishNavalDisposition(state);
          return;
      }
      state.phase = "海军舰队牌处置";
      state.state = "naval_disposition";
      api.setActiveFaction(state, order[0]);
  }

  function navalDisposition(state, disposition) {
      if (!["discard", "shuffle"].includes(disposition))
          throw new Error("Choose whether to discard or reshuffle the Fleet card");
      const order = state.naval.disposition_order || [];
      if (!order.includes(state.active))
          throw new Error("No Fleet card is awaiting disposition");
      state.naval.dispositions[state.active] = disposition;
      const next = order.find((side) => !state.naval.dispositions[side]);
      if (next) {
          api.setActiveFaction(state, next);
          api.log(state, `${api.factionRole(api.other(next))} 已选择舰队牌去向。`);
          return;
      }
      finishNavalDisposition(state);
  }

  function continueNavalEvents(state) {
      const next = state.naval.event_queue.shift();
      if (!next) {
          state.naval.resolving = false;
          const difference = state.naval.pending_difference || 0;
          const previousTrack = state.naval.track;
          state.naval.track = Math.max(-9, Math.min(9, previousTrack + Math.sign(difference)));
          if (state.naval.track !== previousTrack)
              api.log(state, `海军轨：${previousTrack} → ${state.naval.track}。`);
          else if (difference)
              api.log(state, `海军轨停留在${state.naval.track}（已到轨道尽头）。`);
          delete state.naval.pending_difference;
          startNavalDisposition(state);
          return;
      }
      const nextCard = api.cardById[next.card];
      const nextSpec = api.cardSpecById[next.card];
      const canceled = Object.keys(state.events).some((event) => {
          if (api.data.events[event]?.cancel === nextCard.event)
              return true;
          const activeCard = api.data.cards.find((card) => card.event === event);
          return api.cardSpecById[activeCard?.id]?.operations?.some((operation) => operation.type === "cancel_event" && operation.event === nextCard.event);
      });
      if (canceled) {
          const handIndex = state.hands[next.faction].indexOf(next.card);
          if (handIndex >= 0)
              state.hands[next.faction].splice(handIndex, 1);
          state.discard[next.faction].push(next.card);
          api.log(state, `${nextCard.title} 被先结算的海军事件禁止。`);
          continueNavalEvents(state);
          return;
      }
      if (Number.isFinite(nextSpec?.naval_only_points)) {
          const handIndex = state.hands[next.faction].indexOf(next.card);
          if (handIndex >= 0)
              state.hands[next.faction].splice(handIndex, 1);
          if (nextSpec.naval_apply_printed_marker)
              api.applyPrintedWarStatus(state, nextCard, false);
          state.discard[next.faction].push(next.card);
          state.event_history.push({
              card: next.card,
              event: nextCard.event,
              faction: next.faction,
              turn: state.turn,
              round: state.action_round,
              naval_only: true,
          });
          api.log(state, `${nextCard.title}作为海军事件结算，仅提供${nextSpec.naval_only_points}点海军点数。`);
          continueNavalEvents(state);
          return;
      }
      state.naval.resolving = true;
      state.phase = "海军事件结算";
      api.setActiveFaction(state, next.faction);
      state.state = "action_card";
      api.cardUse(state, next.card, "event");
  }

  function navalChoice(state, arg) {
      const faction = state.active;
      const kind = arg?.kind || arg;
      if (!["event", "fleet"].includes(kind))
          throw new Error("Choose event or fleet");
      const card = arg?.card == null ? null : Number(arg.card);
      if (kind === "event") {
          if (!state.hands[faction].includes(card) ||
              !navalEventLegal(state, api.cardById[card], api.eventLegal))
              throw new Error("Choose a legal naval event card");
      }
      else {
          if (card == null) {
              if (state.hands[faction].length)
                  throw new Error("Fleet requires a card");
          }
          else {
              if (!state.hands[faction].includes(card))
                  throw new Error("Fleet card is not in hand");
          }
      }
      state.naval.selections[faction] = { kind, card };
      if (faction === api.CP) {
          api.setActiveFaction(state, api.AP);
          api.log(state, "同盟国已暗出；协约国选择。");
          return;
      }
      for (const side of [api.CP, api.AP]) {
          const selection = state.naval.selections[side];
          let points;
          if (selection.kind === "event") {
              const eventCard = api.cardById[selection.card];
              const definition = api.data.events[eventCard.event];
              const spec = api.cardSpecById[eventCard.id];
              points = eventCard.id === 723 && state.events[api.cardById[746].event]
                  ? 5
                  : Number.isFinite(spec?.naval_event_points)
                  ? spec.naval_event_points
                  : Number.isFinite(spec?.naval_only_points)
                  ? spec.naval_only_points
                  : definition?.naval ?? Math.max(0, api.cardValues(state, eventCard).ops - 1);
              points += navalUseBonus(eventCard);
          }
          else if (selection.card == null)
              points = 0;
          else {
              const fleetCard = api.cardById[selection.card];
              points = fleetPoints(state, fleetCard, state.naval.track);
              const handIndex = state.hands[side].indexOf(fleetCard.id);
              state.hands[side].splice(handIndex, 1);
              if (api.cardUseDisposition(state, fleetCard, "fleet") === "remove") {
                  state.removed[side].push(fleetCard.id);
                  api.log(state, `${fleetCard.title}用于舰队后移除。`);
              }
              else
                  state.naval.pending_fleet_cards[side] = fleetCard.id;
          }
          if (side === api.AP && state.events[api.cardById[643].event])
              points += 1;
          if (side === api.CP && uboatMinimumActive(state, selection))
              points = Math.max(4, points);
          state.naval.points[side] = points;
      }
      const difference = state.naval.points[api.CP] - state.naval.points[api.AP];
      state.naval.pending_difference = difference;
      state.naval.event_queue = [api.CP, api.AP]
          .filter((side) => state.naval.selections[side].kind === "event")
          .sort((a, b) => {
          const pointDifference = state.naval.points[b] - state.naval.points[a];
          if (pointDifference)
              return pointDifference;
          return a === api.AP ? -1 : b === api.AP ? 1 : 0;
      })
          .map((side) => ({
          faction: side,
          card: state.naval.selections[side].card,
      }));
      if (difference === 0)
          api.log(state, "海军平局，U艇轨不移动。");
      else
          api.log(state, `海军点数 CP ${state.naval.points[api.CP]} / AP ${state.naval.points[api.AP]}。`);
      continueNavalEvents(state);
  }
return Object.freeze({
    continueNavalEvents,
    finishNavalDisposition,
    fleetPoints,
    navalChoice,
    navalDisposition,
    navalEventLegal,
    startNaval,
    startNavalDisposition,
  });
}

module.exports = { createNavalSystem };
