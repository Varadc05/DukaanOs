import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';

import '../../core/money.dart';
import '../../data/local_db.dart';
import '../../data/models.dart';
import '../../data/sync_service.dart';

/// One cart for all three input modes (voice, barcode, manual).
class CartModel extends ChangeNotifier {
  CartModel({required this.storeId, required this.db, required this.sync});

  final String storeId;
  final LocalDb db;
  final SyncService sync;
  final Map<String, CartLine> _lines = {};

  List<CartLine> get lines => _lines.values.toList();
  bool get isEmpty => _lines.isEmpty;

  /// Display-only totals. The server recomputes everything from its own prices.
  int get subtotalPaise =>
      _lines.values.fold(0, (s, l) => s + lineTotalPaise(l.product.sellPaise, l.qtyMilli));
  int get taxPaise => _lines.values.fold(
      0, (s, l) => s + inclusiveTaxPaise(lineTotalPaise(l.product.sellPaise, l.qtyMilli), l.product.gstRate));

  void add(Product product, {int qtyMilli = 1000}) {
    final line = _lines[product.id];
    if (line == null) {
      _lines[product.id] = CartLine(product, qtyMilli);
    } else {
      line.qtyMilli += qtyMilli;
    }
    notifyListeners();
  }

  void setQty(String productId, int qtyMilli) {
    if (qtyMilli <= 0) {
      _lines.remove(productId);
    } else {
      _lines[productId]?.qtyMilli = qtyMilli;
    }
    notifyListeners();
  }

  void clear() {
    _lines.clear();
    notifyListeners();
  }

  /// Saves the bill locally FIRST (works offline), then tries to sync. The client sends only
  /// what was sold: product ids and quantities. Prices come from the server.
  Future<String> checkout({required String paymentMode, int discountPaise = 0}) async {
    if (_lines.isEmpty) throw StateError('empty cart');
    final id = const Uuid().v4();
    await db.enqueueBill(id, {
      'id': id,
      'store_id': storeId,
      'payment_mode': paymentMode,
      'discount_paise': discountPaise,
      'device_time': DateTime.now().toUtc().toIso8601String(),
      'items': [
        for (final l in _lines.values) {'product_id': l.product.id, 'qty_milli': l.qtyMilli},
      ],
    });
    clear();
    sync.pushOutbox(); // fire and forget; the outbox retries later if offline
    return id;
  }
}
