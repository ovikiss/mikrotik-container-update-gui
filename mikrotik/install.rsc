# MikroTik install script for Container Update GUI (containerized on RouterOS)
# Import with: /import file-name=install-container-update-gui.rsc
# Adjust variables below before import.

:local mcugContainerName "container-update-gui"
:local mcugImage "ghcr.io/ovikiss/mikrotik-container-update-gui:latest"
:local mcugRootDir "/usb1/containers/container-update-gui"
:local mcugPullDir "/usb1/pull"

:local mcugVeth "veth-mcug"
:local mcugBridge "dockers"
:local mcugSubnet "172.31.250"
:local mcugMask "24"
:local mcugRouterIp ($mcugSubnet . ".1")
:local mcugContainerIp ($mcugSubnet . ".2")

:local mcugLanRouterIp "192.168.88.1"
:local mcugLanCidr "192.168.88.0/24"
:local mcugHttpLanPort "8090"
:local mcugHttpContainerPort "3030"

:local mcugApiScheme "http"
:local mcugApiService "www"
:local mcugApiAllowedAddress "192.168.88.0/24,172.31.250.2/32"
:local mcugApiUser "container-updater"
:local mcugApiPassword "ChangeMe-Now-Strong-Password"
:local mcugApiTargetField ".id"

# Ensure directories on disk
:if ([:len [/file find where name="usb1/containers"]] = 0) do={ /file add name="usb1/containers" type=directory }
:if ([:len [/file find where name="usb1/pull"]] = 0) do={ /file add name="usb1/pull" type=directory }

# Configure container extraction path
/container/config/set tmpdir=$mcugPullDir

# Prepare dedicated API user
:if ([:len [/user/find where name=$mcugApiUser]] = 0) do={
  /user/add name=$mcugApiUser password=$mcugApiPassword group=full comment="Container Update GUI API user"
} else={
  /user/set [find where name=$mcugApiUser] password=$mcugApiPassword group=full comment="Container Update GUI API user"
}

# Ensure REST service access for LAN + container IP
:if ([:len [/ip/service/find where name=$mcugApiService]] = 0) do={
  :error ("Service not found: " . $mcugApiService)
}
/ip/service/set [find where name=$mcugApiService] disabled=no address=$mcugApiAllowedAddress

# Ensure veth exists and is linked to the container bridge
:if ([:len [/interface/veth/find where name=$mcugVeth]] = 0) do={
  /interface/veth/add name=$mcugVeth address=($mcugContainerIp . "/" . $mcugMask) gateway=$mcugRouterIp
} else={
  /interface/veth/set [find where name=$mcugVeth] address=($mcugContainerIp . "/" . $mcugMask) gateway=$mcugRouterIp
}

:if ([:len [/interface/bridge/find where name=$mcugBridge]] = 0) do={
  /interface/bridge/add name=$mcugBridge
}

:if ([:len [/interface/bridge/port/find where interface=$mcugVeth and bridge=$mcugBridge]] = 0) do={
  /interface/bridge/port/add interface=$mcugVeth bridge=$mcugBridge
}

:if ([:len [/ip/address/find where interface=$mcugBridge and address=($mcugRouterIp . "/" . $mcugMask)]] = 0) do={
  /ip/address/add interface=$mcugBridge address=($mcugRouterIp . "/" . $mcugMask)
}

# Prepare env list for the GUI container
:foreach e in=[/container/envs/find where list="mcug"] do={ /container/envs/remove $e }
/container/envs/add list="mcug" key="PORT" value=$mcugHttpContainerPort
/container/envs/add list="mcug" key="ROUTEROS_BASE_URL" value=($mcugApiScheme . "://" . $mcugRouterIp)
/container/envs/add list="mcug" key="ROUTEROS_REST_PREFIX" value="/rest"
/container/envs/add list="mcug" key="ROUTEROS_USERNAME" value=$mcugApiUser
/container/envs/add list="mcug" key="ROUTEROS_PASSWORD" value=$mcugApiPassword
/container/envs/add list="mcug" key="ROUTEROS_ALLOW_INSECURE_TLS" value="true"
/container/envs/add list="mcug" key="ROUTEROS_TIMEOUT_MS" value="15000"
/container/envs/add list="mcug" key="ROUTEROS_ACTION_TARGET_FIELD" value=$mcugApiTargetField
/container/envs/add list="mcug" key="ROUTEROS_CHECK_METHOD" value="POST"
/container/envs/add list="mcug" key="ROUTEROS_CHECK_PATH" value="/container/check-for-updates"
/container/envs/add list="mcug" key="ROUTEROS_CHECK_SEND_TARGET" value="false"
/container/envs/add list="mcug" key="ROUTEROS_CHECK_BODY_JSON" value="{}"
/container/envs/add list="mcug" key="ROUTEROS_UPDATE_METHOD" value="POST"
/container/envs/add list="mcug" key="ROUTEROS_UPDATE_PATH" value="/container/update"
/container/envs/add list="mcug" key="ROUTEROS_UPDATE_SEND_TARGET" value="true"
/container/envs/add list="mcug" key="ROUTEROS_UPDATE_BODY_JSON" value="{}"
/container/envs/add list="mcug" key="ROUTEROS_ROLLBACK_METHOD" value="POST"
/container/envs/add list="mcug" key="ROUTEROS_ROLLBACK_PATH" value="/container/rollback"
/container/envs/add list="mcug" key="ROUTEROS_ROLLBACK_SEND_TARGET" value="true"
/container/envs/add list="mcug" key="ROUTEROS_ROLLBACK_BODY_JSON" value="{}"

# Replace existing GUI container if present
:if ([:len [/container/find where name=$mcugContainerName]] > 0) do={
  /container/stop [find where name=$mcugContainerName]
  /delay 2
  /container/remove [find where name=$mcugContainerName]
}

# Deploy GUI container from remote image
# Explicit entrypoint/cmd avoids RouterOS restart glitches with docker-entrypoint.sh on some builds.
/container/add name=$mcugContainerName remote-image=$mcugImage interface=$mcugVeth dns="192.168.88.1,1.1.1.1" root-dir=$mcugRootDir envlist="mcug" entrypoint="/usr/local/bin/node" cmd="src/server.js" start-on-boot=yes logging=yes
:delay 2
:do { /container/start [find where name=$mcugContainerName] } on-error={ :put "Container start skipped (already starting)." }

# LAN port-forward to GUI (enforce a single managed rule)
:foreach n in=[/ip/firewall/nat/find where comment="mcug-gui"] do={ /ip/firewall/nat/remove $n }
/ip/firewall/nat/add chain=dstnat action=dst-nat protocol=tcp src-address=$mcugLanCidr dst-address=$mcugLanRouterIp dst-port=$mcugHttpLanPort to-addresses=$mcugContainerIp to-ports=$mcugHttpContainerPort comment="mcug-gui"

:put ("Container Update GUI installed. Open http://" . $mcugLanRouterIp . ":" . $mcugHttpLanPort . "/")
