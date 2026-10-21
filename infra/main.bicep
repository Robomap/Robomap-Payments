// Robomap Payments on Azure Container Apps in France Central.
// A dedicated consumption environment keeps this host off the live marketing app.
// The default image is the Container Apps hello-world placeholder so the first
// provision can succeed before the project image is pushed to the registry.
targetScope = 'resourceGroup'

@description('azd environment name. Included in the resource token.')
param environmentName string

@description('Azure region. France Central matches the live robomap.ai Container App.')
param location string = 'francecentral'

@description('Container image. Defaults to the required hello-world placeholder.')
param webImageName string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

@description('Object id of the principal running the deployment. Needs Key Vault Secrets Officer to create the site-host secret.')
param deploymentUserPrincipalId string

@description('Entra principal type of the account running the deployment.')
@allowed([
  'User'
  'ServicePrincipal'
])
param deploymentUserPrincipalType string = 'User'

var resourceToken = toLower(uniqueString(subscription().id, resourceGroup().id, location, environmentName))
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var keyVaultSecretsOfficerRoleId = 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'

var tags = {
  'azd-env-name': environmentName
  'azd-service-name': 'web'
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: 'azid${resourceToken}'
  location: location
  tags: tags
}

resource law 'Microsoft.OperationalInsights/workspaces@2026-03-01' = {
  name: 'azlog${resourceToken}'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2023-06-01' = {
  name: 'azai${resourceToken}'
  location: location
  kind: 'web'
  tags: tags
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: law.id
  }
}

resource acr 'Microsoft.ContainerRegistry/registries@2025-11-01' = {
  name: 'azacr${resourceToken}'
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
    anonymousPullEnabled: false
  }
}

// Defined before the container app. One assignment per registry.
resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, identity.id, acrPullRoleId)
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2026-05-15' = {
  name: 'azkv${resourceToken}'
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

resource identitySecretsOfficer 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, identity.id, keyVaultSecretsOfficerRoleId)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsOfficerRoleId)
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource deployerSecretsOfficer 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, deploymentUserPrincipalId, keyVaultSecretsOfficerRoleId)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsOfficerRoleId)
    principalId: deploymentUserPrincipalId
    principalType: deploymentUserPrincipalType
  }
}

resource siteHostSecret 'Microsoft.KeyVault/vaults/secrets@2026-05-15' = {
  parent: keyVault
  name: 'site-host'
  properties: {
    value: 'payments.robomap.ai'
  }
  dependsOn: [
    identitySecretsOfficer
    deployerSecretsOfficer
  ]
}

resource environment 'Microsoft.App/managedEnvironments@2026-07-01' = {
  name: 'azcae${resourceToken}'
  location: location
  tags: tags
  properties: {
    publicNetworkAccess: 'Enabled'
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: law.properties.customerId
        sharedKey: law.listKeys().primarySharedKey
      }
    }
  }
}

resource web 'Microsoft.App/containerApps@2026-07-01' = {
  name: 'azca${resourceToken}'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 80
        transport: 'auto'
        allowInsecure: false
        corsPolicy: {
          allowedOrigins: [
            'https://robomap.ai'
            'https://www.robomap.ai'
            'https://payments.robomap.ai'
          ]
          allowedMethods: [
            'GET'
            'HEAD'
            'OPTIONS'
          ]
          allowedHeaders: [
            '*'
          ]
          maxAge: 3600
          allowCredentials: false
        }
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: identity.id
        }
      ]
      secrets: [
        {
          name: 'site-host'
          keyVaultUrl: siteHostSecret.properties.secretUri
          identity: identity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: webImageName
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            {
              name: 'PORT'
              value: '80'
            }
            {
              name: 'SITE_HOST'
              secretRef: 'site-host'
            }
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              value: appInsights.properties.ConnectionString
            }
          ]
          probes: [
            {
              type: 'Liveness'
              tcpSocket: {
                port: 80
              }
              initialDelaySeconds: 5
              periodSeconds: 20
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 2
      }
    }
  }
  dependsOn: [
    acrPull
    identitySecretsOfficer
  ]
}

output AZURE_CONTAINER_REGISTRY_ENDPOINT string = acr.properties.loginServer
output AZURE_CONTAINER_REGISTRY_NAME string = acr.name
output SERVICE_WEB_RESOURCE_ID string = web.id
output SERVICE_WEB_NAME string = web.name
output WEB_URI string = 'https://${web.properties.configuration.ingress.fqdn}'
output containerAppFqdn string = web.properties.configuration.ingress.fqdn
output managedEnvironmentName string = environment.name
output resourceToken string = resourceToken
