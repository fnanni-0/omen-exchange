import React, { FC, useState, useEffect } from 'react'
import { ethers } from 'ethers'
import { BigNumber } from 'ethers/utils'

import { MarketView } from './market_view'
import { useConnectedWeb3Context } from '../../hooks/connectedWeb3'
import { ConditionalTokenService, FetchMarketService, RealitioService } from '../../services'
import { getLogger } from '../../util/logger'
import { Status, BalanceItems, OutcomeSlots, StepProfile } from '../../util/types'

const logger = getLogger('Market::MarketView')

interface Props {
  address: string
}

const MarketViewContainer: FC<Props> = props => {
  const context = useConnectedWeb3Context()

  const [balance, setBalance] = useState<BalanceItems[]>([])
  const [address] = useState<string>(props.address)
  const [status, setStatus] = useState<Status>(Status.Ready)
  const [funding, setFunding] = useState<BigNumber>(ethers.constants.Zero)
  const [question, setQuestion] = useState<string | null>(null)
  const [stepProfile, setStepProfile] = useState<StepProfile>(StepProfile.View)

  useEffect(() => {
    const fetchContractData = async ({ enableStatus }: any) => {
      enableStatus && setStatus(Status.Loading)
      try {
        const networkId = context.networkId
        const provider = context.library
        const user = await provider.getSigner().getAddress()

        const fetchMarketService = new FetchMarketService(address, networkId, provider)

        const [
          balanceInformation,
          marketBalanceInformation,
          actualPrice,
          marketFunding,
        ] = await Promise.all([
          fetchMarketService.getBalanceInformation(user),
          fetchMarketService.getBalanceInformation(address),
          fetchMarketService.getActualPrice(),
          fetchMarketService.getFunding(),
        ])

        const probabilityForYes = actualPrice.actualPriceForYes * 100
        const probabilityForNo = actualPrice.actualPriceForNo * 100

        const balance = [
          {
            outcomeName: OutcomeSlots.Yes,
            probability: Math.round((probabilityForYes / 100) * 100),
            currentPrice: actualPrice.actualPriceForYes,
            shares: balanceInformation.balanceOfForYes,
            holdings: marketBalanceInformation.balanceOfForYes,
          },
          {
            outcomeName: OutcomeSlots.No,
            probability: Math.round((probabilityForNo / 100) * 100),
            currentPrice: actualPrice.actualPriceForNo,
            shares: balanceInformation.balanceOfForNo,
            holdings: marketBalanceInformation.balanceOfForNo,
          },
        ]

        setBalance(balance)
        setFunding(marketFunding)

        enableStatus && setStatus(Status.Done)
      } catch (error) {
        logger.error(error && error.message)
        enableStatus && setStatus(Status.Error)
      }
    }

    fetchContractData({ enableStatus: true })

    const intervalId = setInterval(() => {
      fetchContractData({ enableStatus: false })
    }, 2000)

    return () => clearInterval(intervalId)
  }, [address, context])

  // fetch Realitio question data
  useEffect(() => {
    const fetchQuestion = async () => {
      try {
        const networkId = context.networkId
        const provider = context.library

        const fetchMarketService = new FetchMarketService(address, networkId, provider)

        const conditionId = await fetchMarketService.getConditionId()
        const questionId = await ConditionalTokenService.getQuestionId(
          conditionId,
          provider,
          networkId,
        )
        const question = await RealitioService.getQuestion(questionId, provider, networkId)
        setQuestion(question)
      } catch (error) {
        logger.error('There was an error fetching the question data:', error.message)
      }
    }

    fetchQuestion()
  }, [address, context])

  useEffect(() => {
    const fetchContractStatus = async () => {
      try {
        const networkId = context.networkId
        const provider = context.library
        const userAddress = await provider.getSigner().getAddress()

        const fetchMarketService = new FetchMarketService(address, networkId, provider)

        const conditionId = await fetchMarketService.getConditionId()
        const isConditionResolved: boolean = await ConditionalTokenService.isConditionResolved(
          conditionId,
          networkId,
          provider,
        )

        const ownerAddress: string = await fetchMarketService.getOwner()
        const isMarketOwner = ownerAddress.toLowerCase() === userAddress.toLowerCase()

        if (isConditionResolved && isMarketOwner) {
          setStepProfile(StepProfile.Withdraw)
        } else if (isConditionResolved) {
          setStepProfile(StepProfile.Redeem)
        }
      } catch (error) {
        logger.error(error && error.message)
      }
    }

    fetchContractStatus()
  }, [address, context, stepProfile])

  // TODO: fetch resolution date, and add in props
  return (
    <MarketView
      balance={balance}
      funding={funding}
      marketAddress={address}
      question={question || ''}
      resolution={new Date(2019, 10, 30)}
      status={status}
      stepProfile={stepProfile}
    />
  )
}

export { MarketViewContainer }
