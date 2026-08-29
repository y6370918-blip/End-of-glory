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
module.exports = Object.freeze({
  AP,
  AP_ROLE,
  CP,
  CP_ROLE,
  HISTORICAL,
  MO_NATIONS,
  NONE,
});
