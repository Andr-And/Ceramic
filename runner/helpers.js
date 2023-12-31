import child_process from 'child_process'
import * as https from 'https'
import { ECSClient, ListTasksCommand } from '@aws-sdk/client-ecs'

const REPORTING_LEVEL = {
  info: 'info',
  error: 'error'
}

/**
 * Sends Discord message about ECS task
 * @param {any} messageWithoutFields
 */
function reportTask(messageWithoutFields, reportingLevel = REPORTING_LEVEL.info) {
  console.log('Reporting ECS task...')
  const taskId = getThisTaskId()
  const fields = generateDiscordCloudwatchFields([taskId])
  let message = messageWithoutFields
  if (fields.length > 0) {
    message = [{...messageWithoutFields[0], fields}]
  }
  const data = { embeds: message, username: 'cas-runner' }
  const retryDelayMs = 300000 // 300k ms = 5 mins
  let webhookUrl = process.env.DISCORD_WEBHOOK_URL_INFO_CAS
  if (reportingLevel == REPORTING_LEVEL.error) {
    webhookUrl = process.env.DISCORD_WEBHOOK_URL_ALERTS
  }
  sendDiscordNotification(webhookUrl, data, retryDelayMs)
}

/**
 * Returns the ECS id for the running task
 * @returns {string}
 */
function getThisTaskId() {
  const taskId = child_process.execSync(
    `curl -s "$ECS_CONTAINER_METADATA_URI_V4/task" | /runner/node_modules/node-jq/bin/jq -r ".TaskARN" | awk -F / '{print $NF}'`
  ).toString()
  console.log('TASK ID:', taskId)
  return taskId
}

/**
 * Returns kv object for Discord fields
 * @param {Array<string>} taskIds
 * @returns {object}
 */
function generateDiscordCloudwatchFields(taskIds) {
  const fields = taskIds.map((id, index) => {
    const value = `[${id}](${process.env.CLOUDWATCH_LOG_BASE_URL}${id})`
    return { name: `Task logs`, value }
  })
  return fields
}

/**
 * Returns list of running ECS anchor tasks
 * @returns {Array<string>}
 */
async function listECSTasks() {
  const client = new ECSClient({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  })

  const params = {
    cluster: process.env.AWS_ECS_CLUSTER,
    family: process.env.AWS_ECS_FAMILY,
  }

  const command = new ListTasksCommand(params)

  const data = await client.send(command)

  if (data.$metadata.httpStatusCode > 399) {
    throw Error(data.$metadata.httpStatusCode)
  } else {
    return data.taskArns
  }
}

/**
 * Sends a POST to the discord webhookUrl
 * @param {string} webhookUrl Discord webhook url
 * @param {any} data POST data
 * @param {Number} retryDelayMs If -1, will not retry, otherwise the millisecond delay before 1 retry
 */
function sendDiscordNotification(webhookUrl, data, retryDelayMs = -1) {
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  }
  const req = https.request(webhookUrl, options, (res) => {
    console.log(`Notification request status code: ${res.statusCode}`)
    if (res.statusCode >= 500 && retryDelayMs > -1) {
      console.log(`Retrying after ${retryDelayMs} milliseconds...`)
      setTimeout(() => {
        sendDiscordNotification(webhookUrl, data)
      }, retryDelayMs)
    }
  })
  req.on('error', console.error)
  req.write(JSON.stringify(data))
  req.end()
}

export { REPORTING_LEVEL, generateDiscordCloudwatchFields, getThisTaskId, listECSTasks, reportTask, sendDiscordNotification }
