// MIDI pedal messages: control and program changes come through, anything
// a port couldn't deliver is turned away.
import { expect, test } from 'bun:test';
import { pedalMessage } from '../app/src/lib/midi';

test('control and program changes on any channel', () => {
  expect(pedalMessage([0xb0, 20, 127])).toEqual({ kind: 'cc', cc: 20, value: 127 });
  expect(pedalMessage(new Uint8Array([0xbf, 11, 0]))).toEqual({ kind: 'cc', cc: 11, value: 0 });
  expect(pedalMessage([0xc0, 0])).toEqual({ kind: 'program', program: 0 });
  expect(pedalMessage([0xc5, 127])).toEqual({ kind: 'program', program: 127 });
});

test('other messages are ignored', () => {
  expect(pedalMessage([0x90, 60, 100])).toBeNull(); // note on
  expect(pedalMessage([0xe0, 0, 64])).toBeNull(); // pitch bend
  expect(pedalMessage([0xf8])).toBeNull(); // clock
  expect(pedalMessage([0xf0, 0x7e, 0xf7])).toBeNull(); // sysex
});

test('garbage is turned away', () => {
  for (const data of [
    [], [20, 127], // no status byte
    [0xc0, -1], [0xc0, 128], [0xc0, 1.5], [0xc0, '4'], [0xc0, NaN], // bad program numbers
    [0xb0, 20, 300], [0xb0, 300, 0], [0xb0, 20, -1], [0xb0, 20], // bad or missing data bytes
    [0xc0], [0xc0, 4, 0], [0xb0, 20, 127, 0], // wrong length
    [0x1b0, 20, 127], [-80, 20, 127], [0xb0 + 0.5, 20, 127], ['B0', 20, 127], // bad status bytes
    'garbage', [null, undefined],
  ] as ArrayLike<unknown>[]) {
    expect(pedalMessage(data)).toBeNull();
  }
});
