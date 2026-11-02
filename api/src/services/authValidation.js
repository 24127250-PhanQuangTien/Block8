const validator = require("validator");
const { authPolicy } = require("../config/authPolicy");

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function validEmail(value) {
  return validator.isEmail(value, { allow_utf8_local_part: true });
}

function validPassword(value) {
  return typeof value === "string"
    && value.length >= authPolicy.password.minLength
    && value.length <= authPolicy.password.maxLength
    && /\p{L}/u.test(value)
    && /\p{N}/u.test(value);
}

module.exports = { normalizeEmail, validEmail, validPassword };
