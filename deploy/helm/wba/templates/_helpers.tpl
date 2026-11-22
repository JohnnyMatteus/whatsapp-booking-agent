{{- define "wba.labels" -}}
app.kubernetes.io/part-of: wba
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{/* UID numérico do componente: o kubelet recusa runAsNonRoot quando a imagem só declara o nome do usuário. */}}
{{- define "wba.uid" -}}
{{- $uid := toString .uid -}}
{{- if not (regexMatch "^[1-9][0-9]*$" $uid) -}}
{{- fail (printf "o componente %s precisa de um uid numérico diferente de zero (uid: %s)" .name $uid) -}}
{{- end -}}
{{- $uid -}}
{{- end -}}
