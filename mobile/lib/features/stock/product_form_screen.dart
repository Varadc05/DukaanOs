import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:uuid/uuid.dart';

import '../../core/money.dart';
import '../../data/api.dart';
import '../billing/scanner_page.dart';

const _units = ['pc', 'kg', 'g', 'l', 'ml', 'pack'];
const _gstRates = [0, 5, 12, 18, 28];

/// Add a product, or edit one (pass [product], a map from GET /products). Pops true when saved.
class ProductFormScreen extends StatefulWidget {
  const ProductFormScreen({super.key, required this.storeId, this.product});
  final String storeId;
  final Map<String, dynamic>? product;
  @override
  State<ProductFormScreen> createState() => _ProductFormScreenState();
}

class _ProductFormScreenState extends State<ProductFormScreen> {
  final _form = GlobalKey<FormState>();
  late final _name = TextEditingController(text: widget.product?['name'] as String?);
  late final _barcode = TextEditingController(text: widget.product?['barcode'] as String?);
  late final _mrp = TextEditingController(text: _paise('mrp_paise'));
  late final _sell = TextEditingController(text: _paise('sell_paise'));
  late final _aliases = TextEditingController(text: ((widget.product?['aliases'] as List?) ?? []).join(', '));
  final _openingQty = TextEditingController();
  final _openingCost = TextEditingController();
  late String _unit = (widget.product?['unit'] as String?) ?? 'pc';
  late int _gst = (widget.product?['gst_rate'] as int?) ?? 0;
  bool _busy = false;
  String? _error;

  bool get _editing => widget.product != null;

  String _paise(String key) {
    final v = widget.product?[key] as int?;
    return v == null ? '' : paiseToInput(v);
  }

  @override
  void dispose() {
    for (final c in [_name, _barcode, _mrp, _sell, _aliases, _openingQty, _openingCost]) {
      c.dispose();
    }
    super.dispose();
  }

  String? _money(String? v, {bool required = true}) {
    if (v == null || v.trim().isEmpty) return required ? 'Enter an amount' : null;
    return parseRupeesToPaise(v) == null ? 'Use numbers like 45 or 45.50' : null;
  }

  Future<void> _scan() async {
    final code = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => const ScannerPage()));
    if (code != null) setState(() => _barcode.text = code);
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    final mrp = parseRupeesToPaise(_mrp.text) ?? 0;
    final sell = parseRupeesToPaise(_sell.text)!;
    if (mrp > 0 && sell > mrp) {
      setState(() => _error = 'Selling price cannot be above MRP.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final api = context.read<Api>();
    final aliases = _aliases.text
        .split(RegExp(r'[,\n]'))
        .map((a) => a.trim().toLowerCase())
        .where((a) => a.isNotEmpty)
        .toSet()
        .toList();
    final barcode = _barcode.text.trim();
    final body = <String, dynamic>{
      'name': _name.text.trim(),
      'barcode': barcode.isEmpty ? null : barcode,
      'gst_rate': _gst,
      'mrp_paise': mrp,
      'sell_paise': sell,
      'aliases': aliases,
      if (!_editing) 'unit': _unit,
    };
    try {
      if (_editing) {
        await api.sendJson('PATCH', '/v1/stores/${widget.storeId}/products/${widget.product!['id']}', body);
      } else {
        final made = await api.sendJson('POST', '/v1/stores/${widget.storeId}/products', body);
        final qty = parseQtyMilli(_openingQty.text);
        if (qty != null && qty > 0) {
          try {
            await api.sendJson('POST', '/v1/stores/${widget.storeId}/stock/receive', {
              'id': const Uuid().v4(),
              'product_id': made['id'],
              'qty_milli': qty,
              'cost_paise': parseRupeesToPaise(_openingCost.text) ?? 0,
            });
          } on ApiException catch (e) {
            // The product exists now; do not make the owner re-enter it.
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text('Product saved, but starting stock was not added: ${e.message}')));
              Navigator.of(context).pop(true);
            }
            return;
          }
        }
      }
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Could not reach the server. Check your connection and try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    const gap = SizedBox(height: 14);
    return Scaffold(
      appBar: AppBar(title: Text(_editing ? 'Edit product' : 'Add product')),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
          TextFormField(
            controller: _name,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(labelText: 'Product name'),
            validator: (v) => (v == null || v.trim().isEmpty) ? 'Enter a name' : null,
          ),
          gap,
          TextFormField(
            controller: _barcode,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(
              labelText: 'Barcode (optional)',
              suffixIcon: IconButton(icon: const Icon(Icons.qr_code_scanner), tooltip: 'Scan', onPressed: _scan),
            ),
            validator: (v) => (v != null && v.trim().isNotEmpty && v.trim().length < 4) ? 'Too short' : null,
          ),
          gap,
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(
              child: DropdownButtonFormField<String>(
                value: _unit,
                decoration: InputDecoration(
                  labelText: 'Sold by',
                  helperText: _editing ? 'Cannot change' : null,
                ),
                items: [for (final u in _units) DropdownMenuItem(value: u, child: Text(u))],
                onChanged: _editing ? null : (v) => setState(() => _unit = v ?? _unit),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: DropdownButtonFormField<int>(
                value: _gst,
                decoration: const InputDecoration(labelText: 'GST'),
                items: [for (final g in _gstRates) DropdownMenuItem(value: g, child: Text('$g%'))],
                onChanged: (v) => setState(() => _gst = v ?? _gst),
              ),
            ),
          ]),
          gap,
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(
              child: TextFormField(
                controller: _mrp,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'MRP ₹', helperText: 'Put 0 if none'),
                validator: _money,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: TextFormField(
                controller: _sell,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Your price ₹'),
                validator: _money,
              ),
            ),
          ]),
          gap,
          TextFormField(
            controller: _aliases,
            decoration: const InputDecoration(
              labelText: 'Other names (optional)',
              helperText: 'What customers call it, separated by commas. Helps voice billing.',
              helperMaxLines: 2,
            ),
          ),
          if (!_editing) ...[
            const SizedBox(height: 24),
            Text('Stock you have now (optional)', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 10),
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Expanded(
                child: TextFormField(
                  controller: _openingQty,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(labelText: 'Quantity ($_unit)'),
                  validator: (v) => (v == null || v.trim().isEmpty || parseQtyMilli(v) != null) ? null : 'Use numbers like 12 or 2.5',
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextFormField(
                  controller: _openingCost,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(labelText: 'You paid ₹ per $_unit'),
                  validator: (v) => _money(v, required: false),
                ),
              ),
            ]),
          ],
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 16),
              child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error, fontWeight: FontWeight.w600)),
            ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _busy ? null : _save,
            child: _busy
                ? const SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 3, color: Colors.white))
                : Text(_editing ? 'Save changes' : 'Save product'),
          ),
        ]),
      ),
    );
  }
}
