// Mirrors backend/src/money.ts. Used only for DISPLAY while billing offline;
// the server recomputes every price and total from its own catalogue.

/// Quantities are integer thousandths (1000 = 1 kg / 1 litre / 1 piece).
int toMilli(double qty) => (qty * 1000).round();

/// Rounds half up, like the backend (Math.round).
int lineTotalPaise(int pricePaise, int qtyMilli) =>
    ((pricePaise * qtyMilli) / 1000).round();

int inclusiveTaxPaise(int amountPaise, int gstRate) =>
    gstRate == 0 ? 0 : ((amountPaise * gstRate) / (100 + gstRate)).round();

String formatRupees(int paise) {
  final sign = paise < 0 ? '-' : '';
  final abs = paise.abs();
  return '$sign₹${abs ~/ 100}.${(abs % 100).toString().padLeft(2, '0')}';
}

String formatQty(int qtyMilli, String unit) {
  final whole = qtyMilli % 1000 == 0;
  final text = whole ? '${qtyMilli ~/ 1000}' : (qtyMilli / 1000).toStringAsFixed(3).replaceFirst(RegExp(r'0+$'), '');
  return '$text $unit';
}
