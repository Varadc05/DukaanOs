import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'core/theme.dart';
import 'data/api.dart';
import 'data/local_db.dart';
import 'data/sync_service.dart';
import 'features/billing/billing_screen.dart';
import 'features/billing/cart_model.dart';

// Pass these at build time; none of them is a secret (the anon key is public by design):
//   flutter run --dart-define=SUPABASE_URL=... --dart-define=SUPABASE_ANON_KEY=... --dart-define=API_URL=...
const _supabaseUrl = String.fromEnvironment('SUPABASE_URL');
const _supabaseAnonKey = String.fromEnvironment('SUPABASE_ANON_KEY');
const _apiUrl = String.fromEnvironment('API_URL');

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Supabase.initialize(url: _supabaseUrl, anonKey: _supabaseAnonKey);
  final db = await LocalDb.open();
  final api = Api(_apiUrl);
  runApp(MultiProvider(
    providers: [
      Provider.value(value: db),
      Provider.value(value: api),
      Provider(create: (_) => SyncService(db, api)),
    ],
    child: const DukaanApp(),
  ));
}

class DukaanApp extends StatelessWidget {
  const DukaanApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'DukaanOS',
        theme: dukaanTheme(),
        home: const AuthGate(),
      );
}

class AuthGate extends StatelessWidget {
  const AuthGate({super.key});
  @override
  Widget build(BuildContext context) => StreamBuilder<AuthState>(
        stream: Supabase.instance.client.auth.onAuthStateChange,
        builder: (context, _) => Supabase.instance.client.auth.currentSession == null
            ? const LoginScreen()
            : const StoreLoader(),
      );
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  String? _error;
  bool _busy = false;

  Future<void> _signIn() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await Supabase.instance.client.auth
          .signInWithPassword(email: _email.text.trim(), password: _password.text);
    } on AuthException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
              Text('DukaanOS', style: Theme.of(context).textTheme.headlineMedium),
              const SizedBox(height: 24),
              TextField(controller: _email, decoration: const InputDecoration(labelText: 'Email'), keyboardType: TextInputType.emailAddress),
              TextField(controller: _password, decoration: const InputDecoration(labelText: 'Password'), obscureText: true),
              if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: const TextStyle(color: Colors.red))),
              const SizedBox(height: 16),
              FilledButton(onPressed: _busy ? null : _signIn, child: const Text('Sign in')),
            ]),
          ),
        ),
      );
}

/// Finds the signed-in user's store (RLS returns only their own memberships).
class StoreLoader extends StatelessWidget {
  const StoreLoader({super.key});
  @override
  Widget build(BuildContext context) => FutureBuilder<List<Map<String, dynamic>>>(
        future: Supabase.instance.client.from('members').select('store_id').limit(1),
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Scaffold(body: Center(child: CircularProgressIndicator()));
          }
          final rows = snap.data;
          if (rows == null || rows.isEmpty) {
            return Scaffold(
              body: Center(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Text(snap.hasError ? 'Could not load your store. Check your connection.' : 'You are not a member of any store yet.'),
                  TextButton(onPressed: () => Supabase.instance.client.auth.signOut(), child: const Text('Sign out')),
                ]),
              ),
            );
          }
          final storeId = rows.first['store_id'] as String;
          final db = context.read<LocalDb>();
          final sync = context.read<SyncService>();
          return ChangeNotifierProvider(
            create: (_) => CartModel(storeId: storeId, db: db, sync: sync),
            child: BillingScreen(storeId: storeId),
          );
        },
      );
}
