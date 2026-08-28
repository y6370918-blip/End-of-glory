"use strict";

const { AP, AP_ROLE, CP, CP_ROLE, NONE } = require("./constants.js");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function roleFaction(role) {
  if (role === AP_ROLE || role === AP) return AP;
  if (role === CP_ROLE || role === CP) return CP;
  return null;
}

function factionRole(faction) {
  return faction === AP ? AP_ROLE : faction === CP ? CP_ROLE : NONE;
}

function other(faction) {
  return faction === AP ? CP : AP;
}

function unique(values) {
  return [...new Set(values || [])];
}

function removeValue(values, value) {
  return (values || []).filter((candidate) => candidate !== value);
}

module.exports = { clone, factionRole, other, removeValue, roleFaction, unique };
