# axf ctl completion (control-registry@1): candidates come from the registry (entry ids, actions, parameters and
# their allowed values), read from the offline index by `axf ctl __complete`. Source this file, or:
#   eval "$(node framework/cli/axf.mjs ctl completion bash)"
_axf_ctl_complete() {
  local i words=()
  for ((i = 2; i <= COMP_CWORD; i++)); do words+=("${COMP_WORDS[i]}"); done
  [[ "${COMP_WORDS[1]}" == "ctl" ]] || return 0
  local IFS=$'\n'
  COMPREPLY=($(node "${AXF_ROOT:-.}/framework/cli/axf.mjs" ctl __complete "${words[@]}" 2>/dev/null))
}
complete -o default -F _axf_ctl_complete axf
_axf_ctl_bin_complete() {
  local i words=()
  for ((i = 1; i <= COMP_CWORD; i++)); do words+=("${COMP_WORDS[i]}"); done
  local IFS=$'\n'
  COMPREPLY=($(node "${AXF_ROOT:-.}/bin/axf-ctl.mjs" __complete "${words[@]}" 2>/dev/null))
}
complete -o default -F _axf_ctl_bin_complete axf-ctl axf-ctl.mjs
