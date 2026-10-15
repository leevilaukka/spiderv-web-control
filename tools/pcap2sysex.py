#!/usr/bin/env python3
"""Extract Line 6 SysEx messages from a USB capture.

Supports pcapng files containing USBPcap (Windows, linktype 249) or
Linux usbmon (linktype 220) packets. Bulk transfers are decoded as
USB-MIDI event packets and reassembled into SysEx messages.

Usage: pcap2sysex.py capture.pcapng [--raw]
"""
import struct
import sys

LINKTYPE_USBPCAP = 249
LINKTYPE_USBMON_MMAP = 220
LINKTYPE_USBMON = 189

# Number of MIDI bytes carried by each USB-MIDI Code Index Number.
CIN_LEN = {0x4: 3, 0x5: 1, 0x6: 2, 0x7: 3, 0x8: 3, 0x9: 3, 0xA: 3, 0xB: 3,
           0xC: 2, 0xD: 2, 0xE: 3, 0xF: 1, 0x2: 2, 0x3: 3}


def read_blocks(f):
    data = f.read()
    off = 0
    endian = "<"
    linktypes = []
    while off + 12 <= len(data):
        btype, blen = struct.unpack_from(endian + "II", data, off)
        if btype == 0x0A0D0D0A:  # section header: detect byte order
            bom = data[off + 8:off + 12]
            endian = "<" if bom == b"\x4d\x3c\x2b\x1a" else ">"
            btype, blen = struct.unpack_from(endian + "II", data, off)
            linktypes = []
        body = data[off + 8:off + blen - 4]
        if btype == 1:  # interface description
            linktypes.append(struct.unpack_from(endian + "H", body, 0)[0])
        elif btype == 6:  # enhanced packet
            iface, ts_hi, ts_lo, cap_len, _ = struct.unpack_from(endian + "IIIII", body, 0)
            ts = ((ts_hi << 32) | ts_lo) / 1e6
            yield linktypes[iface], ts, body[20:20 + cap_len]
        off += blen


def parse_usb(linktype, pkt):
    """Return (endpoint, direction_in, payload) for bulk/interrupt completions, else None."""
    if linktype == LINKTYPE_USBPCAP:
        hdr_len, _irp, _status, _func, info, _bus, _dev, ep, xfer, dlen = \
            struct.unpack_from("<HQIHBHHBBI", pkt, 0)
        if xfer not in (1, 3):  # interrupt / bulk
            return None
        payload = pkt[hdr_len:hdr_len + dlen]
        if not payload:
            return None
        return ep, bool(ep & 0x80), payload
    if linktype in (LINKTYPE_USBMON_MMAP, LINKTYPE_USBMON):
        hdr_len = 64 if linktype == LINKTYPE_USBMON_MMAP else 48
        _id, ev, xfer, ep = struct.unpack_from("<QcBB", pkt, 0)
        if xfer not in (1, 3):
            return None
        payload = pkt[hdr_len:]
        # OUT data is on the Submit, IN data on the Complete.
        if not payload or (ep & 0x80 and ev != b"C") or (not ep & 0x80 and ev != b"S"):
            return None
        return ep, bool(ep & 0x80), payload
    return None


def usbmidi_to_bytes(payload):
    out = bytearray()
    for i in range(0, len(payload) - 3, 4):
        cin = payload[i] & 0x0F
        if payload[i] == 0 and not any(payload[i + 1:i + 4]):
            continue
        out += payload[i + 1:i + 1 + CIN_LEN.get(cin, 0)]
    return bytes(out)


def main():
    path = sys.argv[1]
    raw = "--raw" in sys.argv
    bufs = {True: bytearray(), False: bytearray()}
    t0 = None
    with open(path, "rb") as f:
        for lt, ts, pkt in read_blocks(f):
            r = parse_usb(lt, pkt)
            if not r:
                continue
            ep, is_in, payload = r
            t0 = ts if t0 is None else t0
            if raw:
                print(f"{ts - t0:9.3f} {'IN ' if is_in else 'OUT'} ep{ep:02x} {payload.hex(' ')}")
                continue
            buf = bufs[is_in]
            for b in usbmidi_to_bytes(payload):
                if b == 0xF0:
                    buf.clear()
                buf.append(b)
                if b == 0xF7:
                    print(f"{ts - t0:9.3f} {'<-' if is_in else '->'} {bytes(buf).hex(' ')}")
                    buf.clear()


if __name__ == "__main__":
    main()
