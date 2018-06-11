import axios from 'axios'
import _ from 'lodash'
import { fromJS } from 'immutable'
import pluralize from 'pluralize'

const minimumData = fromJS({ data: {} })

export default class Client {
  constructor(baseUrl, { usePlural = true } = {}){
    this.baseUrl = (baseUrl.slice(-1) === '/') ? baseUrl : baseUrl + '/'
    this.usePlural = usePlural
    this.models = []
    this.headers = {'Content-Type': 'application/vnd.api+json'}
  }

  define(model){
    this.models.push(model)
  }

  buildRequest({ method = '', data = minimumData.toJS(), meta = {}, urlParams = {}} = {}){

    const url = this.buildUrl(data, urlParams)

    return {
      url,
      method,
      headers: this.headers,
      data,
      meta
    }
  }

  setHeader(key, value){
    this.headers[key] = value
  }

  buildUrl({ data = {} }, { attributes, sort, filter, customParams, path }){
    let url = this.baseUrl

    url += (path) ? path + '/' : ''
    url += (data.id) ? data.id + '/' : ''

    let suffixes = []

    if (attributes) {
      suffixes.push('fields[' + data.type + ']=' + attributes.join(','))
    }

    if (sort) {
      const sortStrings = sort.map((sortingObject) =>
        (sortingObject.orientation && sortingObject.orientation.toLowerCase() === 'desc') ?
          '-' + sortingObject.attribute :
          sortingObject.attribute
      )
      suffixes.push('sort=' + sortStrings.join(','))
    }

    if (filter) {
      suffixes.push('filter=' + filter)
    }

    if (customParams) {
      _.forOwn(customParams, (value, key) => suffixes.push(key + '=' + value))
    }

    url += (!_.isEmpty(suffixes)) ? '?' + suffixes.join('&') : ''

    return url
  }

  buildData({ resource, type, attributes = [] }){
    let result = minimumData.toJS()

    result.data.type = type || this.inferType(resource)

    if (resource) {
      if (resource.id) {
        result.data.id = resource.id
      }
      result.data.attributes = {}

      _.forOwn(resource, (value, property) => {
        if (property !== 'id' && (_.isEmpty(attributes) || _.includes(attributes, property))) {
          if (value && _.includes(this.models, value.constructor)) {
            result.relationships = result.relationships || {}
            result.relationships[property] = this.buildData({ resource: value })
          } else {
            result.data.attributes[property] = value
          }
        }
      })
    }

    return result
  }

  inferType(resource) {
    const resourceType = resource.constructor.name.toLowerCase()
    return (this.usePlural) ?
      pluralize(resourceType) :
      resourceType
  }

  /**
   * Builds the url path for the requested resource / type
   *
   * @param resource - Instance object of a defined model. Its class may or may
   * not implement a custom path behaviour. If not, the class name in lowercase
   * should be taken.
   * @param type - This parameter is either a string or a class. If it's a string
   * that string should be taken as path, but if it's a class we should take care
   * of possible custom path building like the explained for resource.
   * @param extra - Object with custom parameters to send into the custom path
   * build method. Often an id that refers to the container of this model.
   */
  buildPath({ resource, type, extra}) {
    if (_.isString(type)) return type
    if (resource && _.isFunction(resource.constructor.path)) return resource.constructor.path(extra)
    if (!type) return this.inferType(resource)
    if (_.isFunction(type.path)) return type.path(extra)
    return ''
  }

  buildRequestFind({ type, id = 0, meta, attributes, sort, filter, customParams, ...extra} = {}){
    const resource = { id }
    const data = this.buildData({ resource, type })
    const path = this.buildPath({ resource, type, extra })
    const urlParams = { attributes, customParams, path }
    return this.buildRequest({ method: 'GET', data, meta, urlParams })
  }

  buildRequestFindAll({ type, attributes, sort, filter, customParams, ...extra }){
    const data = this.buildData({ type })
    const path = this.buildPath({ type, extra })
    const urlParams = { attributes, sort, filter, customParams, path }
    return this.buildRequest({ method: 'GET', data, urlParams })
  }

  buildRequestUpdate({ resource, type, attributes, ...extra }){
    const data = this.buildData({ resource, type, attributes })
    const path = this.buildPath({ resource, type, extra })
    const urlParams = { attributes, path }
    return this.buildRequest({ method: 'PATCH', data, urlParams })
  }

  buildRequestCreate({ resource, type, attributes, ...extra }){
    const data = this.buildData({ resource, type, attributes })
    const path = this.buildPath({ resource, type, extra })
    const urlParams = { attributes, path }
    return this.buildRequest({ method: 'POST', data, urlParams })
  }

  buildRequestDelete({ resource, type, ...extra }){
    const data = this.buildData({ resource, type })
    const path = this.buildPath({ resource, type, extra })
    const urlParams = { path }
    return this.buildRequest({ method: 'DELETE', data, urlParams })
  }

  // These were split into the method and a build method to be able to test the
  // requests without mocking the network
  find(params){
    return new Promise((resolve, reject) => {
      axios(this.buildRequestFind(params)).then(
        response => resolve(this.deserialize(response.data, params.attributes))
      ).catch(
        error => reject(error)
      )
    })
  }

  findAll(params){
    return new Promise((resolve, reject) => {
      axios(this.buildRequestFindAll(params)).then(
        response => resolve(this.deserializeArray(response.data, params.attributes))
      ).catch(
        error => reject(error)
      )
    })
  }

  update(params){
    return new Promise((resolve, reject) => {
      axios(this.buildRequestUpdate(params)).then(
        response => resolve(this.deserialize(response.data, params.attributes))
      ).catch(
        error => reject(error)
      )
    })
  }

  create(params){
    return new Promise((resolve, reject) => {
      axios(this.buildRequestCreate(params)).then(
        response => resolve(this.deserialize(response.data, params.attributes))
      ).catch(
        error => reject(error)
      )
    })
  }

  delete(params){
    return new Promise((resolve, reject) => {
      axios(this.buildRequestDelete(params)).then(
        response => resolve(response.data)
      ).catch(
        error => reject(error)
      )
    })
  }

  //Allow requests not necessarily in JSON API.
  customRequest(request){
    return axios(request)
  }

  deserialize({ data, included = [] }, params = {}){
    let obj
    let { links = {}, relationships = {}} = data
    try {
      const className = _.upperFirst(pluralize.singular(_.camelCase(data.type)))
      const klass = this.models.find((model) => model.name === className)

      obj = new klass()
    } catch(e) {
      obj = { type: data.type }
    }

    obj.id = data.id

    _.forEach(data.attributes, (value, key) => {
      if(!params.attributes || _.includes(params.attributes, key)) {
        obj[key] = value
      }
    })

    if (!_.isEmpty(links)) {
      obj.links = _.omit(links, 'first', 'last', 'prev', 'next')
      if (links.self) {
        obj.refresh = () => this.customRequest({ url: links.self })
      }
    }

    _.forEach(relationships, (value, key) => {
      if (_.has(obj, key)) {
        obj[key] = (_.isArray(obj[key])) ?
          _.map(value.data, elem => this.deserializeRelationship(elem, included))
          : this.deserializeRelationship(value.data, included)
      }
    })

    return obj
  }

  deserializeRelationship(elem, included = []){
    const includedElem = _.find(included, (e) => e.type == elem.type && e.id == elem.id)
    if(includedElem){
      elem.attributes = includedElem.attributes
    }
    return this.deserialize({data: elem})
  }

  deserializeArray({ data, links = [], included = [] }, klass){
    const response = (_.isArray(data))
      ? _.map(data, elem => this.deserialize({data: elem, included}, klass))
      : this.deserialize({data, included}, klass)

    const paginationLinks = _.pick(links, 'first', 'last', 'prev', 'next')
    _.forOwn(paginationLinks, (value, key) => {
      response[key] = () => this.customRequest({ url: value })
    })

    return response
  }
}
