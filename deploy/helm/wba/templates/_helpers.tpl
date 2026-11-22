{{- define "wba.labels" -}}
app.kubernetes.io/part-of: wba
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}
