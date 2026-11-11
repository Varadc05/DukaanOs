class Product {
  final String id;
  final String storeId;
  final String name;
  final String? barcode;
  final String unit;
  final int sellPaise;
  final int gstRate;

  const Product({
    required this.id,
    required this.storeId,
    required this.name,
    required this.barcode,
    required this.unit,
    required this.sellPaise,
    required this.gstRate,
  });

  factory Product.fromSupabase(Map<String, dynamic> r) => Product(
        id: r['id'] as String,
        storeId: r['store_id'] as String,
        name: r['name'] as String,
        barcode: r['barcode'] as String?,
        unit: r['unit'] as String,
        sellPaise: r['sell_paise'] as int,
        gstRate: (r['gst_rate'] as num).toInt(),
      );

  factory Product.fromRow(Map<String, Object?> r) => Product(
        id: r['id'] as String,
        storeId: r['store_id'] as String,
        name: r['name'] as String,
        barcode: r['barcode'] as String?,
        unit: r['unit'] as String,
        sellPaise: r['sell_paise'] as int,
        gstRate: r['gst_rate'] as int,
      );

  Map<String, Object?> toRow() => {
        'id': id,
        'store_id': storeId,
        'name': name,
        'barcode': barcode,
        'unit': unit,
        'sell_paise': sellPaise,
        'gst_rate': gstRate,
      };
}

class CartLine {
  final Product product;
  int qtyMilli;
  CartLine(this.product, this.qtyMilli);
}
