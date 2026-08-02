import { writeFileSync } from 'node:fs';
import { renderReceiptPdf, receiptFileName } from '../server/pdf.js';

const receipt = {
  number: 41,
  title: 'Mart (Example)',
  place: 'Mart (Example)',
  location_address:
    '265 Street 160, Sector L Dha Phase 1, Lahore, Pakistan (Coordinates: 31.479917764663696, 74.40063714981079)',
  lat: 31.479918,
  lng: 74.400637,
  customer_name: 'Umer Butt',
  customer_phone: '0304 4545431',
  customer_email: 'wr.covid.4@gmail.com',
  customer_address: '265/1 , Sector L, Phase 1 , Street 160, DHA Lahore Pakistan',
  currency: 'PKR',
  category: 'Shopping',
  payment_method: 'Cash',
  discount: 50,
  tax_percent: 15,
  cash_given: 500,
  note1: 'Thank you for shopping!',
  note2: 'This is an example !',
  signature: '',
  issuer_name: 'Umer Butt',
  issuer_email: 'wr.covid.4@gmail.com',
  created_at: '2026-08-01T22:28:03',
  items: [{ name: 'Courasant', qty: 5, price: 12 }],
};

const buf = await renderReceiptPdf(receipt);
writeFileSync('/tmp/cashmemer-test-receipt.pdf', buf);
console.log('bytes:', buf.length);
console.log('filename:', receiptFileName(receipt, new Date('2026-08-01T22:32:29')));
console.log('expected:', 'Receipt_41___Mart_Example___20260801_22_32_29___Cash_Memer.pdf');
