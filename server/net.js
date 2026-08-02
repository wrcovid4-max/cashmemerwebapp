/**
 * Works out this computer's address on your Wi-Fi, so you never have to go
 * hunting for it yourself.
 */
import { networkInterfaces } from 'node:os';

/** Private ranges, in the order a home/shop router hands them out. */
function rank(ip) {
  if (ip.startsWith('192.168.')) return 0;
  if (/^10\./.test(ip)) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
  return 9;
}

/** Interfaces that are never the one your phone can reach. */
function isUseless(name) {
  return /^(lo|docker|br-|veth|vmnet|vboxnet|utun|tun|tap|zt|wg|ham)/i.test(name);
}

/**
 * @returns {{address: string, iface: string}[]} every candidate LAN address,
 *   best guess first. Empty if this machine has no network at all.
 */
export function lanAddresses() {
  const found = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (isUseless(name)) continue;
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('169.254.')) continue; // self-assigned, unreachable
      found.push({ address: a.address, iface: name });
    }
  }
  found.sort((a, b) => {
    const r = rank(a.address) - rank(b.address);
    if (r !== 0) return r;
    // Wi-Fi before Ethernet — the phone is on Wi-Fi.
    const wifi = (n) => (/(wl|wi-?fi|wlan|en0)/i.test(n) ? 0 : 1);
    return wifi(a.iface) - wifi(b.iface);
  });
  return found;
}

/** The single best guess for "the address my phone should use". */
export function primaryLanAddress() {
  return lanAddresses()[0]?.address ?? null;
}
