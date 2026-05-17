# MikroTik install script for Container Update GUI (RouterOS REST prep)
# Import with: /import file-name=install-container-update-gui.rsc
# Adjust variables below before import.

:local mcugService "www-ssl"
:local mcugAllowedAddress "192.168.88.0/24"
:local mcugUser "container-updater"
:local mcugPassword "ChangeMe-Now-Strong-Password"
:local mcugUserGroup "full"

# Enable REST service endpoint (www-ssl recommended, or www for lab testing)
:if ([:len [/ip/service/find where name=$mcugService]] = 0) do={
  :error ("Service not found: " . $mcugService)
}

/ip/service/set [find where name=$mcugService] disabled=no address=$mcugAllowedAddress

# Create or update dedicated REST user
:if ([:len [/user/find where name=$mcugUser]] = 0) do={
  /user/add name=$mcugUser password=$mcugPassword group=$mcugUserGroup comment="Container Update GUI REST user"
} else={
  /user/set [find where name=$mcugUser] password=$mcugPassword group=$mcugUserGroup comment="Container Update GUI REST user"
}

:put "Container Update GUI router prep completed."
:put ("Service enabled: " . $mcugService)
:put ("Allowed source: " . $mcugAllowedAddress)
:put ("User: " . $mcugUser)
