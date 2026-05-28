/**
 * hcl-grammar.ts — Terraform / HCL syntax highlighting for highlight.js v11
 *
 * Adapted from highlightjs-terraform (MIT, Nikos Tsirmirakis).
 * Source: https://github.com/highlightjs/highlightjs-terraform
 *
 * Registered under both "terraform" and "hcl" aliases.
 */

import type { HLJSApi, Language, Mode } from 'highlight.js';

export default function hljsDefineTerraform(hljs: HLJSApi): Language {
  const NUMBERS: Mode = {
    className: 'number',
    begin: '\\b\\d+(\\.\\d+)?',
    relevance: 0,
  };

  const STRINGS: Mode = {
    className: 'string',
    begin: '"',
    end: '"',
    contains: [{
      className: 'variable',
      begin: '\\${',
      end: '\\}',
      relevance: 9,
      contains: [{
        className: 'string',
        begin: '"',
        end: '"',
      }, {
        className: 'meta',
        begin: '[A-Za-z_0-9]*' + '\\(',
        end: '\\)',
        contains: [
          NUMBERS,
          {
            className: 'string',
            begin: '"',
            end: '"',
            contains: [{
              className: 'variable',
              begin: '\\${',
              end: '\\}',
              contains: [{
                className: 'string',
                begin: '"',
                end: '"',
                contains: [{
                  className: 'variable',
                  begin: '\\${',
                  end: '\\}',
                } as Mode],
              } as Mode, {
                className: 'meta',
                begin: '[A-Za-z_0-9]*' + '\\(',
                end: '\\)',
              } as Mode],
            } as Mode],
          } as Mode,
          'self',
        ],
      } as Mode],
    } as Mode],
  };

  return {
    name: 'Terraform',
    aliases: ['tf', 'hcl'],
    keywords: 'resource variable provider output locals module data terraform',
    literal: 'false true null',
    contains: [
      hljs.COMMENT('\\#', '$'),
      NUMBERS,
      STRINGS,
    ],
  } as Language;
}
