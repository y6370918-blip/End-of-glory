"use strict";

const AP = "ap";
const CP = "cp";
const NONE = "None";
const AP_ROLE = "Allied Powers";
const CP_ROLE = "Central Powers";
const HISTORICAL = "1914 Historical";
const MO_NATIONS = Object.freeze({
  [CP]: Object.freeze(["ge", "ah"]),
  [AP]: Object.freeze(["fr", "br", "it", "us"]),
});
const FRENCH_VP_SPACES = new Set([
  "calais", "lille", "arras", "amiens", "cambrai", "beauvais", "noyon",
  "reims", "evreux", "compiegne", "paris", "chateau_thierry", "verdun",
  "bar_le_duc", "melun", "sezanne", "orleans", "troyes", "sens",
  "nancy", "dijon", "mulhouse",
]);

module.exports = Object.freeze({
  AP,
  AP_ROLE,
  CP,
  CP_ROLE,
  FRENCH_VP_SPACES,
  HISTORICAL,
  MO_NATIONS,
  NONE,
});
