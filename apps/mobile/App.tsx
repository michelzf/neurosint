// App.tsx — Neurosint (app Expo / React Native). Slice F4 v1: Login → Caso → Perguntar → Linha
// do tempo. Reaproveita os mesmos endpoints do backend (via src/api.ts). Roda em web e nativo.
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { api, type AskResult, type Patient, type Record_ } from "./src/api";

export default function App() {
  const [health, setHealth] = useState("verificando…");
  const [email, setEmail] = useState("cuidador@dev.local");
  const [password, setPassword] = useState("neurosint-dev");
  const [loggedIn, setLoggedIn] = useState(false);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [msg, setMsg] = useState("");

  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);

  const [timeline, setTimeline] = useState<Record_[]>([]);

  useEffect(() => {
    api.health()
      .then((j) => setHealth(`${j.target} · LLM=${(j.providers as Record<string, string>)?.llm} · egress_ok=${j.egress_ok}`))
      .catch(() => setHealth("indisponível"));
  }, []);

  async function doLogin() {
    setMsg("entrando…");
    try {
      await api.login(email, password);
      const ps = await api.patients();
      setPatient(ps[0] || null);
      setLoggedIn(true);
      setMsg("");
      if (ps[0]) setTimeline(await api.timeline(ps[0].id));
    } catch (e) {
      setMsg("Erro: " + (e as Error).message);
    }
  }

  async function doAsk() {
    if (!patient || !question.trim()) return;
    setAsking(true);
    setResult(null);
    try {
      setResult(await api.ask(patient.id, question.trim()));
      setTimeline(await api.timeline(patient.id));
    } catch (e) {
      setMsg("Erro: " + (e as Error).message);
    } finally {
      setAsking(false);
    }
  }

  return (
    <View style={s.app}>
      <StatusBar style="light" />
      <View style={s.header}><Text style={s.headerText}>🛡️ Neurosint</Text></View>
      <ScrollView contentContainerStyle={s.main}>
        <Text style={s.muted} testID="status">Backend: {health}</Text>

        {!loggedIn
          ? (
            <View style={s.card}>
              <Text style={s.h2}>Entrar</Text>
              <Text style={s.label}>E-mail</Text>
              <TextInput testID="email" style={s.input} autoCapitalize="none" value={email} onChangeText={setEmail} />
              <Text style={s.label}>Senha</Text>
              <TextInput testID="password" style={s.input} secureTextEntry value={password} onChangeText={setPassword} />
              <Pressable testID="login-btn" style={s.btn} onPress={doLogin}><Text style={s.btnText}>Entrar</Text></Pressable>
              {msg ? <Text style={s.muted}>{msg}</Text> : null}
            </View>
          )
          : (
            <>
              <View style={s.card}>
                <Text style={s.patient} testID="patient-name">{patient?.name ?? "(sem caso)"}</Text>
                {patient?.diagnosis ? <Text style={s.pill}>{patient.diagnosis}</Text> : null}
              </View>

              <View style={s.card}>
                <Text style={s.h2}>Perguntar ao Neurosint</Text>
                <TextInput
                  testID="ask-input"
                  style={[s.input, s.textarea]}
                  multiline
                  placeholder="Ex.: ele acordou tremendo hoje, é normal?"
                  value={question}
                  onChangeText={setQuestion}
                />
                <Pressable testID="ask-btn" style={s.btn} onPress={doAsk}>
                  <Text style={s.btnText}>{asking ? "Pensando…" : "Perguntar"}</Text>
                </Pressable>
                {asking ? <ActivityIndicator style={{ marginTop: 8 }} /> : null}
                {result
                  ? (
                    <>
                      <View style={s.answer}><Text testID="answer">{result.answer}</Text></View>
                      {result.alert
                        ? <View style={s.alert}><Text testID="alert">⚠ {result.alert.severity.toUpperCase()}: {result.alert.reason}</Text></View>
                        : null}
                    </>
                  )
                  : null}
              </View>

              <View style={s.card}>
                <Text style={s.h2}>Linha do tempo</Text>
                <View testID="timeline">
                  {timeline.length
                    ? timeline.map((r, i) => (
                      <View key={i} style={s.item}>
                        <Text style={s.itemHead}>{r.record_type} · {r.record_date ?? ""}</Text>
                        <Text>{r.title}</Text>
                        {r.summary ? <Text style={s.muted}>{r.summary}</Text> : null}
                      </View>
                    ))
                    : <Text style={s.muted}>Nenhum registro ainda.</Text>}
                </View>
              </View>
            </>
          )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  app: { flex: 1, backgroundColor: "#f3f7f4" },
  header: { backgroundColor: "#009c3b", paddingTop: 44, paddingBottom: 14, paddingHorizontal: 20 },
  headerText: { color: "#fff", fontSize: 22, fontWeight: "700" },
  main: { padding: 16, maxWidth: 760, width: "100%", alignSelf: "center" },
  card: { backgroundColor: "#fff", borderRadius: 14, padding: 18, marginVertical: 8 },
  h2: { fontSize: 19, fontWeight: "700", marginBottom: 8, color: "#15321f" },
  label: { fontSize: 14, color: "#5b6b60", marginTop: 8 },
  input: { borderWidth: 1, borderColor: "#cdd8d0", borderRadius: 10, padding: 12, marginTop: 4, fontSize: 16, backgroundColor: "#fff" },
  textarea: { minHeight: 70 },
  btn: { backgroundColor: "#009c3b", borderRadius: 10, paddingVertical: 12, paddingHorizontal: 22, marginTop: 12, alignSelf: "flex-start" },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  muted: { color: "#5b6b60", fontSize: 14, marginTop: 6 },
  patient: { fontSize: 18, fontWeight: "700", color: "#15321f" },
  pill: { backgroundColor: "#e7efe9", alignSelf: "flex-start", paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, marginTop: 6, fontSize: 13 },
  answer: { backgroundColor: "#eef6f0", borderLeftWidth: 4, borderLeftColor: "#009c3b", padding: 12, borderRadius: 8, marginTop: 12 },
  alert: { backgroundColor: "#fff3f1", borderLeftWidth: 4, borderLeftColor: "#c0392b", padding: 10, borderRadius: 8, marginTop: 8 },
  item: { borderTopWidth: 1, borderTopColor: "#eee", paddingVertical: 10 },
  itemHead: { fontWeight: "700", color: "#15321f" },
});
