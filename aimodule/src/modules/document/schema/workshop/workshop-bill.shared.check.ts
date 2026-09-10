import assert from 'node:assert/strict';
import { expandLineItemsArrayRows } from './workshop-bill.shared.js';

// [0:s, 1:pl, 2:code, 3:hsn, 4:desc, 5:uom, 6:qty, 7:rate, 8:dis, 9:ta, 10:tx, 11:total, 12:header]
const partArray = ['1', 'PART', '1420608250B', '', 'CLIP', '', '20', '25.42', '', '508.4', '91.51', '599.91', ''];
const labourArray = ['1', 'LABOUR', '', '', 'FRONT FENDER PANEL (RH, REFINISH)', '', '1', '2055', '', '2055', '369.9', '2424.9', ''];

const fromArrays = expandLineItemsArrayRows({ lineItemsTable: [partArray, labourArray] });
const [part, labour] = fromArrays.lineItemsTable as Record<string, unknown>[];

assert.equal(part.rowType, 'PART');
assert.equal(part.rate, 25.42);
assert.equal(part.partsCost, 599.91);
assert.equal(part.labourCost, null);

assert.equal(labour.rowType, 'LABOUR');
assert.equal(labour.rate, null);
assert.equal(labour.labourCost, null);
assert.equal(labour.taxableAmount, 2055);
assert.equal(labour.totalAmount, 2424.9);

const fromObjects = expandLineItemsArrayRows({
  lineItemsTable: [{
    rowType: 'LABOUR',
    description: 'Denting Charges',
    rate: 5000,
    partsCost: 5900,
    labourCost: 5900,
    taxableAmount: 5000,
    taxAmount: 900,
    totalAmount: 5900,
  }],
});
const [objLabour] = fromObjects.lineItemsTable as Record<string, unknown>[];
assert.equal(objLabour.rate, null);
assert.equal(objLabour.labourCost, null);
assert.equal(objLabour.partsCost, 5900);
assert.equal(objLabour.totalAmount, 5900);

console.log('workshop-bill.shared.check: ok');
