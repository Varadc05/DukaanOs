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
}
