/* @flow */

/*:: import type { Scenario } from '..' */

module.exports = ({
  disabled: {
    remote: 'Does not work with AtomWatcher yet.'
  },
  init: [{ ino: 1, path: 'a', content: 'initial content' }],
  actions: [
    { type: 'mv', src: 'a', dst: 'b' },
    { type: 'create_file', path: 'a', content: 'new content' }
  ],
  expected: {
    tree: ['a', 'b'],
    contents: {
      a: 'new content',
      b: 'initial content'
    }
  }
} /*: Scenario */)
