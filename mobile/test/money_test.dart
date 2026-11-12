import 'package:dukaanos/core/money.dart';
import 'package:flutter_test/flutter_test.dart';

// Mirrors the backend money tests so the offline display matches the server.
void main() {
  test('loose quantities price exactly in paise', () {
    expect(lineTotalPaise(4500, toMilli(0.5)), 2250);
    expect(lineTotalPaise(4500, toMilli(2.25)), 10125);
  });
  test('GST is extracted from inclusive prices', () {
    expect(inclusiveTaxPaise(10500, 5), 500);
    expect(inclusiveTaxPaise(11800, 18), 1800);
    expect(inclusiveTaxPaise(10000, 0), 0);
  });
  test('formats rupees and quantities', () {
    expect(formatRupees(22300), '₹223.00');
    expect(formatRupees(5), '₹0.05');
    expect(formatQty(2000, 'kg'), '2 kg');
    expect(formatQty(500, 'kg'), '0.5 kg');
  });
  test('parses what a shopkeeper types', () {
    expect(parseRupeesToPaise('45'), 4500);
    expect(parseRupeesToPaise('45.5'), 4550);
    expect(parseRupeesToPaise('₹1,250.05'), 125005);
    expect(parseRupeesToPaise('45.555'), isNull);
    expect(parseRupeesToPaise('-3'), isNull);
    expect(parseRupeesToPaise(''), isNull);
    expect(parseRupeesToPaise('abc'), isNull);
    expect(parseQtyMilli('2'), 2000);
    expect(parseQtyMilli('0.5'), 500);
    expect(parseQtyMilli('1.250'), 1250);
    expect(parseQtyMilli('1.2345'), isNull);
    expect(parseQtyMilli('1,5'), isNull);
  });
  test('turns stored values back into input text', () {
    expect(paiseToInput(4500), '45');
    expect(paiseToInput(4550), '45.5');
    expect(paiseToInput(4505), '45.05');
    expect(milliToInput(2500), '2.5');
  });
}
