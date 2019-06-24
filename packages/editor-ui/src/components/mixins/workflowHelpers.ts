import { PLACEHOLDER_EMPTY_WORKFLOW_ID } from '@/constants';

import {
	INode,
	INodeExecutionData,
	INodeIssues,
	INodeType,
	INodeTypeDescription,
	IRunData,
	IRunExecutionData,
	IWorfklowIssues,
	INodeCredentials,
	Workflow,
	NodeHelpers,
} from 'n8n-workflow';

import {
	IExecutionResponse,
	INodeTypesMaxCount,
	INodeUi,
	IWorkflowData,
} from '../../Interface';

import { restApi } from '@/components/mixins/restApi';
import { nodeHelpers } from '@/components/mixins/nodeHelpers';
import { showMessage } from '@/components/mixins/showMessage';

import mixins from 'vue-typed-mixins';

export const workflowHelpers = mixins(
	nodeHelpers,
	restApi,
	showMessage,
)
	.extend({
		methods: {
			// Returns connectionInputData to be able to execute an expression.
			connectionInputData (parentNode: string[], inputName: string, runIndex: number, inputIndex: number): INodeExecutionData[] | null {
				let connectionInputData = null;

				if (parentNode.length) {
					// Add the input data to be able to also resolve the short expression format
					// which does not use the node name
					const parentNodeName = parentNode[0];

					const workflowRunData = this.$store.getters.getWorkflowRunData as IRunData | null;
					if (workflowRunData === null) {
						return null;
					}
					if (!workflowRunData[parentNodeName] ||
						workflowRunData[parentNodeName].length <= runIndex ||
						!workflowRunData[parentNodeName][runIndex].hasOwnProperty('data') ||
						workflowRunData[parentNodeName][runIndex].data === undefined ||
						!workflowRunData[parentNodeName][runIndex].data!.hasOwnProperty(inputName) ||
						workflowRunData[parentNodeName][runIndex].data![inputName].length <= inputIndex
					) {
						connectionInputData = [];
					} else {
						connectionInputData = workflowRunData[parentNodeName][runIndex].data![inputName][inputIndex];
					}
				}

				return connectionInputData;
			},

			// Returns a shallow copy of the nodes which means that all the data on the lower
			// levels still only gets referenced but the top level object is a different one.
			// This has the advantage that it is very fast and does not cause problems with vuex
			// when the workflow replaces the node-parameters.
			getNodes (): INodeUi[] {
				const nodes = this.$store.getters.allNodes;
				const returnNodes: INodeUi[] = [];

				for (const node of nodes) {
					returnNodes.push(Object.assign({}, node));
				}

				return returnNodes;
			},

			// Returns data about nodeTypes which ahve a "maxNodes" limit set.
			// For each such type does it return how high the limit is, how many
			// already exist and the name of this nodes.
			getNodeTypesMaxCount (): INodeTypesMaxCount {
				const nodes = this.$store.getters.allNodes;

				const returnData: INodeTypesMaxCount = {};

				const nodeTypes = this.$store.getters.allNodeTypes;
				for (const nodeType of nodeTypes) {
					if (nodeType.maxNodes !== undefined) {
						returnData[nodeType.name] = {
							exist: 0,
							max: nodeType.maxNodes,
							nodeNames: [],
						};
					}
				}

				for (const node of nodes) {
					if (returnData[node.type] !== undefined) {
						returnData[node.type].exist += 1;
						returnData[node.type].nodeNames.push(node.name);
					}
				}

				return returnData;
			},

			// Returns how many nodes of the given type currently exist
			getNodeTypeCount (nodeType: string): number {
				const nodes = this.$store.getters.allNodes;

				let count = 0;

				for (const node of nodes) {
					if (node.type === nodeType) {
						count++;
					}
				}

				return count;
			},

			// Checks if everything in the workflow is complete and ready to be executed
			checkReadyForExecution (workflow: Workflow) {
				let node: INode;
				let nodeType: INodeType | undefined;
				let nodeIssues: INodeIssues | null = null;
				const workflowIssues: IWorfklowIssues = {};

				for (const nodeName of Object.keys(workflow.nodes)) {
					nodeIssues = null;
					node = workflow.nodes[nodeName];

					if (node.disabled === true) {
						continue;
					}

					nodeType = workflow.nodeTypes.getByName(node.type);

					if (nodeType === undefined) {
						// Node type is not known
						nodeIssues = {
							typeUnknown: true,
						};
					} else {
						nodeIssues = this.getNodeIssues(nodeType.description, node, ['execution']);
					}

					if (nodeIssues !== null) {
						workflowIssues[node.name] = nodeIssues;
					}
				}

				if (Object.keys(workflowIssues).length === 0) {
					return null;
				}

				return workflowIssues;
			},

			// Returns a workflow instance.
			getWorkflow (copyData?: boolean): Workflow {
				const nodes = this.getNodes();
				const connections = this.$store.getters.allConnections;

				const nodeTypes = {
					init: async () => { },
					getAll: () => {
						// Does not get used in Workflow so no need to return it
						return [];
					},
					getByName: (nodeType: string) => {
						const nodeTypeDescription = this.$store.getters.nodeType(nodeType);

						if (nodeTypeDescription === null) {
							return undefined;
						}

						return {
							description: nodeTypeDescription,
						};
					},
				};

				let workflowId = this.$store.getters.workflowId;
				if (workflowId !== PLACEHOLDER_EMPTY_WORKFLOW_ID) {
					workflowId = undefined;
				}

				if (copyData === true) {
					return new Workflow(workflowId, JSON.parse(JSON.stringify(nodes)), JSON.parse(JSON.stringify(connections)), false, nodeTypes);
				} else {
					return new Workflow(workflowId, nodes, connections, false, nodeTypes);
				}
			},

			// Returns the currently loaded workflow as JSON.
			getWorkflowDataToSave (): Promise<IWorkflowData> {
				const workflowNodes = this.$store.getters.allNodes;
				const workflowConnections = this.$store.getters.allConnections;

				let nodeData;

				const nodes = [];
				for (let nodeIndex = 0; nodeIndex < workflowNodes.length; nodeIndex++) {
					try {
						// @ts-ignore
						nodeData = this.getNodeDataToSave(workflowNodes[nodeIndex]);
					} catch (e) {
						return Promise.reject(e);
					}

					nodes.push(nodeData);
				}

				const data: IWorkflowData = {
					name: this.$store.getters.workflowName,
					nodes,
					connections: workflowConnections,
					active: this.$store.getters.isActive,
					settings: this.$store.getters.workflowSettings,
				};

				const workflowId = this.$store.getters.workflowId;
				if (workflowId !== PLACEHOLDER_EMPTY_WORKFLOW_ID) {
					data.id = workflowId;
				}

				return Promise.resolve(data);
			},

			// Returns all node-types
			getNodeDataToSave (node: INodeUi): INodeUi {
				const skipKeys = [
					'color',
					'continueOnFail',
					'credentials',
					'disabled',
					'issues',
					'notes',
					'parameters',
					'status',
				];

				// @ts-ignore
				const nodeData: INodeUi = {
					parameters: {},
				};

				for (const key in node) {
					if (key.charAt(0) !== '_' && skipKeys.indexOf(key) === -1) {
						// @ts-ignore
						nodeData[key] = node[key];
					}
				}

				// Get the data of the node type that we can get the default values
				// TODO: Later also has to care about the node-type-version as defaults could be different
				const nodeType = this.$store.getters.nodeType(node.type) as INodeTypeDescription;

				if (nodeType !== null) {
					// Node-Type is known so we can save the parameters correctly

					const nodeParameters = NodeHelpers.getNodeParameters(nodeType.properties, node.parameters, false, false);
					nodeData.parameters = nodeParameters !== null ? nodeParameters : {};

					// Add the node credentials if there are some set and if they should be displayed
					if (node.credentials !== undefined && nodeType.credentials !== undefined) {
						const saveCredenetials: INodeCredentials = {};
						for (const nodeCredentialTypeName of Object.keys(node.credentials)) {
							const credentialTypeDescription = nodeType.credentials
								.find((credentialTypeDescription) => credentialTypeDescription.name === nodeCredentialTypeName);

							if (credentialTypeDescription === undefined) {
								// Credential type is not know so do not save
								continue;
							}

							if (this.displayParameter(node.parameters, credentialTypeDescription, '') === false) {
								// Credential should not be displayed so do also not save
								continue;
							}

							saveCredenetials[nodeCredentialTypeName] = node.credentials[nodeCredentialTypeName];
						}

						// Set credential property only if it has content
						if (Object.keys(saveCredenetials).length !== 0) {
							nodeData.credentials = saveCredenetials;
						}
					}

					// Save the node color only if it is different to the default color
					if (node.color && node.color !== nodeType.defaults.color) {
						nodeData.color = node.color;
					}
				} else {
					// Node-Type is not known so save the data as it is
					nodeData.credentials = node.credentials;
					nodeData.parameters = node.parameters;
					if (nodeData.color !== undefined) {
						nodeData.color = node.color;
					}
				}

				// Save the disabled property and continueOnFail only when is set
				if (node.disabled === true) {
					nodeData.disabled = true;
				}
				if (node.continueOnFail === true) {
					nodeData.continueOnFail = true;
				}

				// Save the notes only if when they contain data
				if (![undefined, ''].includes(node.notes)) {
					nodeData.notes = node.notes;
				}

				return nodeData;
			},

			// Executes the given expression and returns its value
			resolveExpression (expression: string) {
				const inputIndex = 0;
				const itemIndex = 0;
				const runIndex = 0;
				const inputName = 'main';
				const activeNode = this.$store.getters.activeNode;
				const workflow = this.getWorkflow();
				const parentNode = workflow.getParentNodes(activeNode.name, inputName, 1);
				const executionData = this.$store.getters.getWorkflowExecution as IExecutionResponse | null;
				let connectionInputData = this.connectionInputData(parentNode, inputName, runIndex, inputIndex);

				let runExecutionData: IRunExecutionData;
				if (executionData === null) {
					runExecutionData = {
						resultData: {
							runData: {},
						},
					};
				} else {
					runExecutionData = executionData.data;
				}

				if (connectionInputData === null) {
					connectionInputData = [];
				}

				return workflow.getParameterValue(expression, runExecutionData, runIndex, itemIndex, activeNode.name, connectionInputData, true);
			},

			// Saves the currently loaded workflow to the database.
			async saveCurrentWorkflow (withNewName = false) {
				const currentWorkflow = this.$route.params.name;
				let workflowName: string | null | undefined = '';
				if (currentWorkflow === undefined || withNewName === true) {
					// Currently no workflow name is set to get it from user
					workflowName = await this.$prompt(
						'Enter workflow name',
						'Name',
						{
							confirmButtonText: 'Save',
							cancelButtonText: 'Cancel',
						}
					)
						.then((data) => {
							// @ts-ignore
							return data.value;
						})
						.catch(() => {
							// User did cancel
							return undefined;
						});

					if (workflowName === undefined) {
						// User did cancel
						return;
					} else if (['', null].includes(workflowName)) {
						// User did not enter a name
						this.$showMessage({
							title: 'Name missing',
							message: `No name for the workflow got entered and could so not be saved!`,
							type: 'error',
						});
						return;
					}
				}

				try {
					this.$store.commit('addActiveAction', 'workflowSaving');

					let workflowData: IWorkflowData = await this.getWorkflowDataToSave();

					if (currentWorkflow === undefined || withNewName === true) {
						// Workflow is new or is supposed to get saved under a new name
						// so create a new etnry in database
						workflowData.name = workflowName as string;
						workflowData = await this.restApi().createNewWorkflow(workflowData);

						this.$store.commit('setWorkflowName', workflowData.name);
						this.$store.commit('setWorkflowId', workflowData.id);
					} else {
						// Workflow exists already so update it
						await this.restApi().updateWorkflow(currentWorkflow, workflowData);
					}

					this.$router.push({
						name: 'NodeViewExisting',
						params: { name: workflowData.id as string, action: 'workflowSave' },
					});

					this.$store.commit('removeActiveAction', 'workflowSaving');

					this.$showMessage({
						title: 'Workflow saved',
						message: `The workflow "${workflowData.name}" got saved!`,
						type: 'success',
					});
				} catch (e) {
					this.$store.commit('removeActiveAction', 'workflowSaving');

					this.$showMessage({
						title: 'Problem saving workflow',
						message: `There was a problem saving the workflow: "${e.message}"`,
						type: 'error',
					});
				}
			},
		},
	});