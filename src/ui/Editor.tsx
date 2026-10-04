import { useRef } from "react";
import Editor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { API_DTS } from "./apiDocs";

// Bundle Monaco locally (instead of the default CDN loader) and give it
// its web workers: the base editor worker plus the TS/JS worker that
// powers autocomplete for the elevator API.
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};
loader.config({ monaco });
// Expose for debugging/E2E assertions.
(window as unknown as { monaco: typeof monaco }).monaco = monaco;

monaco.languages.typescript.javascriptDefaults.addExtraLib(
  API_DTS,
  "ts:elevator/api.d.ts"
);
monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
  target: monaco.languages.typescript.ScriptTarget.ES2020,
  allowNonTsExtensions: true,
});

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
}

export function CodeEditor({ value, onChange, onRun }: CodeEditorProps) {
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;

  return (
    <Editor
      language="javascript"
      theme="vs-dark"
      value={value}
      onChange={(v) => onChange(v ?? "")}
      onMount={(editor) => {
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
          onRunRef.current()
        );
        editor.focus();
      }}
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        padding: { top: 12 },
        renderWhitespace: "none",
        fixedOverflowWidgets: true,
      }}
    />
  );
}
