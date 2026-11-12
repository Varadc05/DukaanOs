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

/// Parses what a shopkeeper types: "45", "45.5", "1,250.50", "₹45". Returns paise, or null if
/// it is not a plain amount with at most two decimals. Done on the text, never via double.
int? parseRupeesToPaise(String input) {
  final t = input.replaceAll('₹', '').replaceAll(',', '').trim();
  final m = RegExp(r'^(\d+)(?:\.(\d{1,2}))?$').firstMatch(t);
  if (m == null) return null;
  final whole = int.parse(m.group(1)!);
  final frac = (m.group(2) ?? '').padRight(2, '0');
  return whole * 100 + int.parse(frac.isEmpty ? '0' : frac);
}

/// Parses a quantity such as "2", "0.5" or "1.250" into thousandths. Null if invalid.
int? parseQtyMilli(String input) {
  final t = input.trim();
  final m = RegExp(r'^(\d+)(?:\.(\d{1,3}))?$').firstMatch(t);
  if (m == null) return null;
  final whole = int.parse(m.group(1)!);
  final frac = (m.group(2) ?? '').padRight(3, '0');
  return whole * 1000 + int.parse(frac.isEmpty ? '0' : frac);
}

/// Plain number for an input box: 4500 paise -> "45", 4550 -> "45.5".
String paiseToInput(int paise) {
  final whole = paise ~/ 100;
  final frac = paise % 100;
  if (frac == 0) return '$whole';
  final f = frac.toString().padLeft(2, '0').replaceFirst(RegExp(r'0$'), '');
  return '$whole.$f';
}

String milliToInput(int milli) => formatQty(milli, '').trim();
