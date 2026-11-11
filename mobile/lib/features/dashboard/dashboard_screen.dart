import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/money.dart';
import '../../data/api.dart';

/// Today's takings, the last 7 days and best sellers. Needs internet (reads server data).
class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key, required this.storeId});
  final String storeId;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sales')),
      body: FutureBuilder<Map<String, dynamic>>(
        future: context.read<Api>().getJson('/v1/stores/$storeId/dashboard'),
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError) {
            return const Center(child: Text('Could not load sales. Check your connection.'));
          }
          final d = snap.data!;
          final today = d['today'] as Map<String, dynamic>;
          final days = (d['last_7_days'] as List).cast<Map<String, dynamic>>();
          final top = (d['top_sellers'] as List).cast<Map<String, dynamic>>();
          final peak = days.map((x) => x['total_paise'] as int).fold(1, (a, b) => a > b ? a : b);
          return ListView(padding: const EdgeInsets.all(16), children: [
            Text('Today', style: Theme.of(context).textTheme.labelLarge),
            Text(formatRupees(today['total_paise'] as int), style: Theme.of(context).textTheme.displaySmall),
            Text('${today['bills']} bills'),
            const SizedBox(height: 24),
            Text('Last 7 days', style: Theme.of(context).textTheme.titleMedium),
            for (final x in days)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(children: [
                  SizedBox(width: 56, child: Text((x['day'] as String).substring(5))),
                  Expanded(
                    child: LinearProgressIndicator(value: (x['total_paise'] as int) / peak, minHeight: 10),
                  ),
                  SizedBox(width: 84, child: Text(formatRupees(x['total_paise'] as int), textAlign: TextAlign.right)),
                ]),
              ),
            const SizedBox(height: 24),
            Text('Best sellers this week', style: Theme.of(context).textTheme.titleMedium),
            for (final t in top)
              ListTile(
                dense: true,
                title: Text(t['name'] as String),
                trailing: Text(formatQty(t['qty_milli'] as int, t['unit'] as String)),
              ),
          ]);
        },
      ),
    );
  }
}
