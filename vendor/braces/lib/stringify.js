'use strict';

const utils = require('./utils');
const { MAX_BRACE_DEPTH } = require('./constants');

module.exports = (ast, options = {}) => {
  const stringify = (node, parent = {}) => {
    const depth = (parent.depth || 0) + 1;
    if (depth > MAX_BRACE_DEPTH) {
      throw new RangeError(`brace nesting exceeds max depth (${MAX_BRACE_DEPTH})`);
    }
    node.depth = depth;
    const invalidBlock = options.escapeInvalid && utils.isInvalidBrace(parent);
    const invalidNode = node.invalid === true && options.escapeInvalid === true;
    let output = '';

    if (node.value) {
      if ((invalidBlock || invalidNode) && utils.isOpenOrClose(node)) {
        return '\\' + node.value;
      }
      return node.value;
    }

    if (node.value) {
      return node.value;
    }

    if (node.nodes) {
      for (const child of node.nodes) {
        output += stringify(child, node);
      }
    }
    return output;
  };

  return stringify(ast);
};

